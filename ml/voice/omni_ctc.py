"""Meta Omnilingual ASR CTC models (omniASR_CTC_*_v2) in plain PyTorch, without fairseq2.

Why: fairseq2 (the official runtime) has no native Windows support, and the lab link was too slow on
29 Oct to pull a second CUDA PyTorch (~4 GB) into WSL. The CTC models are a standard wav2vec 2.0 encoder
(pre-LayerNorm transformer, conv feature extractor, conv positional encoder) plus a linear CTC head, so we
re-declare the modules with fairseq2's exact parameter names and load the official checkpoint with
`strict=True` (every name and shape must match, or loading fails).

Architecture values come from the official sources (omnilingual-asr 0.2.0, fairseq2 0.6):
  wav2vec2_ssl/config.py: 1b = 48 layers, dim 1280, FFN 5120; 3b = 60 layers, dim 2048, FFN 8192;
  both inherit fairseq2 "large_lv60k" (16 heads, pre-LN, 7-layer conv extractor with layer norm, conv
  positional encoder kernel 128 / 16 groups). wav2vec2_asr/config.py: *_v2 vocab = 10288.
Inference follows omnilingual_asr/models/inference/pipeline.py: 16 kHz mono, waveform normalised with
layer_norm(waveform, waveform.shape), bf16, argmax CTC, merge repeats, decode ids with the SentencePiece
char tokenizer skipping special tokens. Audio must be shorter than 40 s (the pipeline's limit).
Licence of code and weights: Apache-2.0 (Meta, github.com/facebookresearch/omnilingual-asr).
"""
from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F

ARCHS = {
    "300m_v2": dict(dim=1024, layers=24, heads=16, ffn=4096),
    "1b_v2": dict(dim=1280, layers=48, heads=16, ffn=5120),
    "3b_v2": dict(dim=2048, layers=60, heads=16, ffn=8192),
}
VOCAB_V2 = 10288
_CONV_SPEC = [(512, 10, 5)] + [(512, 3, 2)] * 4 + [(512, 2, 2)] * 2


class _ConvLayer(nn.Module):
    def __init__(self, cin, cout, k, s):
        super().__init__()
        self.conv = nn.Conv1d(cin, cout, k, stride=s, bias=True)
        self.layer_norm = nn.LayerNorm(cout)

    def forward(self, x):
        x = self.conv(x)
        x = self.layer_norm(x.transpose(1, 2)).transpose(1, 2)
        return F.gelu(x)


class _FeatureExtractor(nn.Module):
    def __init__(self):
        super().__init__()
        layers, cin = [], 1
        for cout, k, s in _CONV_SPEC:
            layers.append(_ConvLayer(cin, cout, k, s))
            cin = cout
        self.layers = nn.ModuleList(layers)

    def forward(self, wav):  # (B, T) -> (B, T', 512)
        x = wav.unsqueeze(1)
        for layer in self.layers:
            x = layer(x)
        return x.transpose(1, 2)


class _WeightNormConv(nn.Module):
    """Grouped conv whose weight is stored as weight_norm(dim=2) parameters (weight_g, weight_v)."""

    def __init__(self, dim, k, groups):
        super().__init__()
        self.weight_g = nn.Parameter(torch.empty(1, 1, k))
        self.weight_v = nn.Parameter(torch.empty(dim, dim // groups, k))
        self.bias = nn.Parameter(torch.empty(dim))
        self.k, self.groups = k, groups

    def forward(self, x):  # (B, D, T)
        w = torch._weight_norm(self.weight_v, self.weight_g, 2)
        return F.conv1d(x, w, self.bias, padding=self.k // 2, groups=self.groups)


class _PosEncoder(nn.Module):
    def __init__(self, dim, k=128, groups=16):
        super().__init__()
        self.conv = _WeightNormConv(dim, k, groups)
        self.remove_pad = k % 2 == 0

    def forward(self, x):  # (B, T, D)
        y = self.conv(x.transpose(1, 2))
        if self.remove_pad:
            y = y[:, :, :-1]
        return x + F.gelu(y).transpose(1, 2)


class _Frontend(nn.Module):
    def __init__(self, dim):
        super().__init__()
        self.feature_extractor = _FeatureExtractor()
        self.post_extract_layer_norm = nn.LayerNorm(512)
        self.model_dim_proj = nn.Linear(512, dim)
        self.pos_encoder = _PosEncoder(dim)

    def forward(self, wav):
        x = self.feature_extractor(wav)
        x = self.post_extract_layer_norm(x)
        x = self.model_dim_proj(x)
        return self.pos_encoder(x)


class _Attention(nn.Module):
    def __init__(self, dim, heads):
        super().__init__()
        self.heads = heads
        self.q_proj = nn.Linear(dim, dim)
        self.k_proj = nn.Linear(dim, dim)
        self.v_proj = nn.Linear(dim, dim)
        self.output_proj = nn.Linear(dim, dim)

    def forward(self, x):
        b, t, d = x.shape
        h = self.heads
        q = self.q_proj(x).view(b, t, h, d // h).transpose(1, 2)
        k = self.k_proj(x).view(b, t, h, d // h).transpose(1, 2)
        v = self.v_proj(x).view(b, t, h, d // h).transpose(1, 2)
        o = F.scaled_dot_product_attention(q, k, v)
        return self.output_proj(o.transpose(1, 2).reshape(b, t, d))


class _FFN(nn.Module):
    def __init__(self, dim, inner):
        super().__init__()
        self.inner_proj = nn.Linear(dim, inner)
        self.output_proj = nn.Linear(inner, dim)

    def forward(self, x):
        return self.output_proj(F.gelu(self.inner_proj(x)))


class _Layer(nn.Module):
    def __init__(self, dim, heads, ffn):
        super().__init__()
        self.self_attn_layer_norm = nn.LayerNorm(dim)
        self.self_attn = _Attention(dim, heads)
        self.ffn_layer_norm = nn.LayerNorm(dim)
        self.ffn = _FFN(dim, ffn)

    def forward(self, x):
        x = x + self.self_attn(self.self_attn_layer_norm(x))
        return x + self.ffn(self.ffn_layer_norm(x))


class _Encoder(nn.Module):
    def __init__(self, dim, layers, heads, ffn):
        super().__init__()
        self.layers = nn.ModuleList([_Layer(dim, heads, ffn) for _ in range(layers)])
        self.layer_norm = nn.LayerNorm(dim)

    def forward(self, x):
        for layer in self.layers:
            x = layer(x)
        return self.layer_norm(x)


class OmniCTC(nn.Module):
    def __init__(self, arch="1b_v2", vocab=VOCAB_V2):
        super().__init__()
        a = ARCHS[arch]
        self.encoder_frontend = _Frontend(a["dim"])
        self.encoder = _Encoder(a["dim"], a["layers"], a["heads"], a["ffn"])
        self.final_proj = nn.Linear(a["dim"], vocab)

    def forward(self, wav):  # wav: (B, T) normalised, model dtype
        return self.final_proj(self.encoder(self.encoder_frontend(wav)))


class OmniCTCTranscriber:
    """Load once, then transcribe 16 kHz mono float32 numpy/tensor waveforms (< 40 s)."""

    def __init__(self, ckpt_path, tokenizer_path, arch="1b_v2", device="cuda", dtype=torch.bfloat16):
        import sentencepiece as spm

        self.device, self.dtype = torch.device(device), dtype
        sd = torch.load(ckpt_path, map_location="cpu", weights_only=True, mmap=True)
        sd = sd.get("model", sd)
        sd = {k[6:] if k.startswith("model.") else k: v for k, v in sd.items()}
        model = OmniCTC(arch)
        model.load_state_dict(sd, strict=True)  # raises if any parameter name or shape differs
        del sd
        self.model = model.to(device=self.device, dtype=self.dtype).eval()
        self.sp = spm.SentencePieceProcessor(model_file=str(tokenizer_path))
        self.special = {i for i in range(self.sp.get_piece_size()) if self.sp.is_control(i) or self.sp.is_unknown(i)}
        self.name = f"omniASR_CTC_{arch.upper().replace('_V2', '')}_v2 (native PyTorch port)"

    @torch.inference_mode()
    def transcribe(self, wav, sample_rate=16000) -> str:
        if sample_rate != 16000:
            raise ValueError("expects 16 kHz audio")
        x = torch.as_tensor(wav, dtype=torch.float32, device=self.device).flatten()
        if x.numel() / 16000 >= 40:
            raise ValueError("audio must be shorter than 40 s for the CTC models")
        x = F.layer_norm(x, x.shape).to(self.dtype).unsqueeze(0)
        logits = self.model(x)[0]
        ids = logits.argmax(-1)
        keep = torch.ones_like(ids, dtype=torch.bool)
        keep[1:] = ids[1:] != ids[:-1]
        ids = [int(i) for i in ids[keep].tolist() if int(i) not in self.special]
        return self.sp.decode(ids).strip()
