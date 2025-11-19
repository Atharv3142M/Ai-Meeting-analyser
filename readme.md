POAi v2.0 – Productivity Optimization Assistant

> A production-grade, local-first meeting recorder with AI-powered insights — fully private and offline.








---

🚀 Overview

POAi v2.0 is a next-generation, local-first meeting intelligence system built for privacy, accuracy, and productivity.

It records meetings directly from your browser, transcribes them using OpenAI Whisper, and generates rich AI summaries using local LLMs (Ollama) — all on your own machine.

No cloud. No external APIs. No data leaks.
Everything stays local.


---

✨ Key Features

🔒 100% Local & Private

All recordings, transcripts, and summaries are processed and stored locally.

Zero cloud uploads.


🎥 High-Fidelity Recording

Captures system audio, microphone audio, and high-resolution screen video.


🎙️ Advanced Transcription

GPU-accelerated Whisper for industry-leading transcription quality.


🗣️ Speaker Diarization

Automatically detects and labels multiple speakers.


🧠 AI-Powered Intelligence

Local Llama 3 (Ollama) generates:

Executive summaries

Action items

Highlights

Key decisions



📊 Professional Dashboard

Modern dark UI

View, manage, search, and replay your meeting library.


⚡ Fix-It-First Architecture

Automatically detects and repairs corrupt or incomplete web recordings before processing.



---

🛠️ System Architecture

POAi v2.0 consists of two coordinated components:

1️⃣ Chrome Extension — Recorder

Captures screen, mic, and system audio

Uploads raw recording to backend


2️⃣ Python Backend — “The Brain”

Repairs & processes recordings

Runs Whisper transcription

Runs LLM summarization (via Ollama)

Stores all data into MongoDB

Hosts the analytics dashboard



---

📦 Installation & Setup

Prerequisites

Ensure the following are installed:

Python 3.11+

MongoDB Community Server (running at localhost:27017)

FFmpeg (added to PATH)

Ollama with llama3 model installed

NVIDIA GPU (recommended) for faster Whisper transcription



---

1. Backend Setup

Clone repository:

git clone https://github.com/yourusername/POAi-v2.git
cd POAi-v2/python_backend

Create & activate virtual environment:

python -m venv env

# Windows
.\env\Scripts\activate

# macOS/Linux
source env/bin/activate

Install dependencies:

# PyTorch with CUDA (example for Windows + CUDA 11.8)
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu118

# Remaining requirements
pip install -r requirements.txt

Run environment check and start server:

python setup.py
python server.py

Backend will run at:

http://127.0.0.1:5000


---

2. Chrome Extension Setup

1. Open Chrome


2. Visit: chrome://extensions


3. Enable Developer Mode


4. Click Load unpacked


5. Select: chrome_extension folder


6. Pin POAi v2.0 to toolbar




---

🚦 Usage Guide

✅ 1. Start Backend

Run:

python server.py

🎥 2. Start Recording

Click the POAi Chrome extension

Click Start Recording

Select screen/window/tab

Enable “Share system audio” for meeting audio


🛑 3. Stop Recording

Click extension → Stop Recording

File uploads to local server instantly

Backend:

Repairs recording

Transcribes using Whisper

Summarizes using Llama 3

Stores metadata in MongoDB



📊 4. View Dashboard

Open:

http://127.0.0.1:5000

Your processed meeting will appear automatically.


---

🔮 Future Roadmap

🟢 Real-time Transcription Overlay (Live captions during meetings)

🟢 Calendar Integration (Auto-record scheduled meetings)

🟢 Semantic Search across entire meeting history

🟢 Multi-language Support with on-device translation



---

📄 License

This project is licensed under the MIT License.
See the LICENSE file for details.


---

POAi v2.0 — Privacy First. Productivity Always.


---

