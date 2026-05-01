# 🚀 Resume Intelligence Engine

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![React](https://img.shields.io/badge/React-18.x-61DAFB?logo=react)](https://reactjs.org/)
[![Vite](https://img.shields.io/badge/Vite-Latest-646CFF?logo=vite)](https://vitejs.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4.0-38B2AC?logo=tailwind-css)](https://tailwindcss.com/)
[![Gemini AI](https://img.shields.io/badge/Powered_By-Gemini_2.0-8E75B2?logo=google-gemini)](https://aistudio.google.com/)

An enterprise-grade AI resume orchestration platform that leverages Google Search grounding and Large Language Models (LLMs) to synthesize professional, ATS-optimized resumes. By autonomously analyzing GitHub repositories and LinkedIn profiles, it converts raw engineering metadata into high-impact career narratives.

---

## 🏗️ Technical Architecture

The application implements a multi-stage synthesis pipeline designed for low-latency and high-accuracy profile extraction.

### 1. Extraction Pipeline (Concurrency Optimized)
Uses parallel asynchronous worker streams to fetch and structure data from disparate sources:
- **GitHub Intelligence**: Scans repositories to identify the "Top 3" highest-impact projects based on star-velocity, complexity, and commit frequency.
- **LinkedIn Contextualization**: Extracts professional chronology and exact job titles using real-time search grounding.

### 2. Synthesis Engine
- **Model Orchestration**: Utilizes `gemini-3.1-pro` for final assembly to ensure structural integrity and professional tone.
- **Prompt Engineering**: Employes chain-of-thought system instructions to enforce ATS-friendly formatting (contact -> summary -> skills -> experience -> projects -> education).

### 3. Export Layer
- Direct-to-buffer conversion of Markdown to Word-compatible XML/HTML for seamless `.doc` downloads.

---

## ✨ Key Features

- **🌐 Live Search Grounding**: Unlike static LLMs, it uses Google Search to pull *current* metadata from your profiles.
- **📊 Metric-Driven Bullet Points**: Automatically generates impact-focused descriptions (e.g., "Improved performance by X% using Y").
- **🛠️ Tech Stack Decomposition**: Automatically extracts and categorizes technologies used in individual projects.
- **📄 Native `.doc` Export**: Generates industry-standard document formats compatible with all major ATS portals.
- **⚡ Reactive UI**: Built with a split-pane architecture to provide instantaneous feedback during resume generation.

---

## 🛠️ Installation & Setup

### Prerequisites
- **Node.js**: v18.0.0+
- **Package Manager**: npm or yarn
- **API Access**: A valid `GEMINI_API_KEY` from Google AI Studio.

### Quick Start
```bash
# Clone the repository
git clone https://github.com/your-org/resume-ai-generator.git

# Navigate to project
cd resume-ai-generator

# Install dependencies
npm install

# Configure Environment
cp .env.example .env
# Edit .env and add your GEMINI_API_KEY
```

### Development
```bash
npm run dev
```

---

## 🧪 Technical Decisions

### Why Gemini 2.0 Flash?
We use `gemini-2.0-flash` for initial search-based profile extraction because of its high throughput and low-latency performance in multi-turn reasoning.

### Why Tailwind CSS v4?
Leverages the latest JIT engine for a minimal CSS footprint and rapid design-to-implementation cycles.

### No Storage Persistence
For user privacy, this application is designed as a stateless engine. All profile processing happens in memory and is transient, ensuring adherence to data privacy best practices.

---

## 🛡️ Security & Privacy
- **API Key Safety**: API keys are managed via server-side environment variables and never exposed to the client-side bundle.
- **Ephemeral Processing**: No user data is persisted in databases.

---

## 🤝 Contributing
Contributions are welcome! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📄 License
This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
