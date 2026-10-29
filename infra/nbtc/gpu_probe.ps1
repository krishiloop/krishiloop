# A 10-second probe: can a background job see the GPU through CUDA?
nvidia-smi --query-gpu=name,memory.used,memory.total --format=csv,noheader
& 'C:\Users\User\miniforge3\envs\dl\python.exe' -c "import torch;x=torch.randn(4096,4096,device='cuda');y=x@x;torch.cuda.synchronize();print('torch cuda ok', torch.cuda.get_device_name(0), float(y.abs().mean()))"
