"""Launcher for `python -I` on the 5090: puts this folder (trusted code) on sys.path, then runs a package module.
Usage: python -I run_module.py kl_research.fetch run ...   (data folders are passed as arguments, never imported)"""
import os
import runpy
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
mod = sys.argv[1]
sys.argv = [mod] + sys.argv[2:]
runpy.run_module(mod, run_name="__main__", alter_sys=True)
