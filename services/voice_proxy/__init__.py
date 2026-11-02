"""Sovereign speech input for the farmer app: a thin proxy to our own voice service on this machine (P1 #13)."""
from services.voice_proxy.proxy import ENV, router, voice_url

__all__ = ["ENV", "router", "voice_url"]
