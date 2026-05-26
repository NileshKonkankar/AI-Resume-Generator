import { useState, useRef, useEffect } from 'react';
import { motion } from 'motion/react';
import { Github, Linkedin, Briefcase, FileText, Loader2, Copy, CheckCircle2, Sparkles, Upload, X, AlertCircle, Download, History, Trash2, Calendar, Sun, Moon } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight, vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { generateResumeStream, ResumeFile, analyzeResume, ResumeAnalysis } from './services/gemini';
import { ResumeHistoryItem } from './types';

const highlightKeywords = (text: string, keywords: string[]): string => {
  if (!keywords || keywords.length === 0) return text;
  
  // Sort keywords by length descending to match larger composite terms first
  const sortedKeywords = [...keywords].sort((a, b) => b.length - a.length);
  const escapeRegExp = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  let highlighted = text;
  for (const keyword of sortedKeywords) {
    if (!keyword || !keyword.trim()) continue;
    const escaped = escapeRegExp(keyword.trim());
    // Safe boundary match, ensuring we do not match inside HTML tags or URLs
    const regex = new RegExp(`(?<![a-zA-Z0-9_-]|^https?:\\/\\/[\\/a-zA-Z0-9%_-]*)${escaped}(?![a-zA-Z0-9_-]|[^<]*>)`, 'gi');
    highlighted = highlighted.replace(regex, (match) => {
      return `<mark class="bg-amber-100 dark:bg-amber-950/40 text-amber-950 dark:text-amber-200 px-1 py-0.5 rounded-sm font-medium border-b border-amber-300 dark:border-amber-700 transition-all font-sans mx-0.5 select-all" title="ATS Keyword Match">${match}</mark>`;
    });
  }
  return highlighted;
};

export default function App() {
  const [githubUrl, setGithubUrl] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [targetJob, setTargetJob] = useState('');
  const [additionalContext, setAdditionalContext] = useState('');
  const [resumeFile, setResumeFile] = useState<(ResumeFile & { name: string }) | null>(null);
  const [urlErrors, setUrlErrors] = useState({ github: '', linkedin: '' });
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStep, setGenerationStep] = useState<string>('');
  const [isUploading, setIsUploading] = useState(false);
  const [resumeMarkdown, setResumeMarkdown] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [atsScore, setAtsScore] = useState<ResumeAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [isHighlightingKeywords, setIsHighlightingKeywords] = useState(false);

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('theme');
      if (saved === 'dark' || saved === 'light') return saved;
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark';
      }
    }
    return 'light';
  });

  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  const [historyList, setHistoryList] = useState<ResumeHistoryItem[]>([]);
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'create' | 'history'>('create');

  useEffect(() => {
    const saved = localStorage.getItem('resume_generation_history');
    if (saved) {
      try {
        setHistoryList(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse resume history", e);
      }
    }
  }, []);

  const saveToHistory = (item: ResumeHistoryItem) => {
    setHistoryList(prev => {
      const updated = [item, ...prev].slice(0, 30);
      localStorage.setItem('resume_generation_history', JSON.stringify(updated));
      return updated;
    });
  };

  const updateHistoryScore = (id: string, score: ResumeAnalysis) => {
    setHistoryList(prev => {
      const updated = prev.map(item => item.id === id ? { ...item, atsScore: score } : item);
      localStorage.setItem('resume_generation_history', JSON.stringify(updated));
      return updated;
    });
  };

  const deleteHistoryItem = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setHistoryList(prev => {
      const updated = prev.filter(item => item.id !== id);
      localStorage.setItem('resume_generation_history', JSON.stringify(updated));
      return updated;
    });
    if (activeHistoryId === id) {
      setActiveHistoryId(null);
    }
  };

  const loadHistoryItem = (item: ResumeHistoryItem) => {
    setGithubUrl(item.githubUrl || '');
    setLinkedinUrl(item.linkedinUrl || '');
    setTargetJob(item.targetJob || '');
    setAdditionalContext(item.additionalContext || '');
    setResumeMarkdown(item.resumeMarkdown || '');
    setAtsScore(item.atsScore || null);
    setActiveHistoryId(item.id);
    setAnalysisError(null);
    setError(null);
    
    if (item.resumeFileName && item.resumeFileData) {
      setResumeFile({
        data: item.resumeFileData,
        mimeType: item.resumeFileMimeType || 'text/plain',
        name: item.resumeFileName
      });
    } else {
      setResumeFile(null);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check for supported MIME types (Gemini API supports PDF and Plain Text via inlineData)
    const supportedTypes = ['application/pdf', 'text/plain'];
    if (!supportedTypes.includes(file.type) && !file.name.endsWith('.txt')) {
      setError("Unsupported file format. Please upload a PDF or .txt file. Word documents (.docx) are not supported directly by the API.");
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      return;
    }

    setIsUploading(true);
    setError(null);
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = (reader.result as string).split(',')[1];
      setResumeFile({
        data: base64String,
        mimeType: file.type || 'text/plain',
        name: file.name
      });
      setIsUploading(false);
    };
    reader.onerror = () => {
      console.error("Failed to read file");
      setIsUploading(false);
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveFile = () => {
    setResumeFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    
    let isValid = true;
    const errors = { github: '', linkedin: '' };

    const githubRegex = /^https?:\/\/(www\.)?github\.com\/[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}\/?$/;
    const linkedinRegex = /^https?:\/\/([a-z]{2,3}\.)?linkedin\.com\/in\/[a-zA-Z0-9-]{3,100}\/?$/;

    if (githubUrl && !githubRegex.test(githubUrl.trim())) {
      errors.github = 'Please enter a valid GitHub profile URL (e.g., https://github.com/username)';
      isValid = false;
    }

    if (linkedinUrl && !linkedinRegex.test(linkedinUrl.trim())) {
      errors.linkedin = 'Please enter a valid LinkedIn profile URL (e.g., https://linkedin.com/in/username)';
      isValid = false;
    }

    setUrlErrors(errors);
    if (!isValid) return;

    if (!githubUrl && !linkedinUrl && !resumeFile) return;

    // Client-side rate limiting (e.g., 60 seconds)
    const RATE_LIMIT_MS = 60 * 1000;
    const lastGenTime = localStorage.getItem('lastResumeGenerationTime');
    if (lastGenTime) {
      const timeElapsed = Date.now() - parseInt(lastGenTime, 10);
      if (timeElapsed < RATE_LIMIT_MS) {
        const waitTime = Math.ceil((RATE_LIMIT_MS - timeElapsed) / 1000);
        setError(`Rate limit active. Please wait ${waitTime} seconds before generating again to optimize API quota.`);
        return;
      }
    }

    localStorage.setItem('lastResumeGenerationTime', Date.now().toString());
    
    setIsGenerating(true);
    setGenerationStep('Initializing intelligence engine...');
    setError(null);
    setResumeMarkdown('');
    setAtsScore(null);
    setAnalysisError(null);
    
    // Yield to the browser's paint loop to ensure the disabled state, loading spinner, and skeleton loaders render immediately
    await new Promise(resolve => setTimeout(resolve, 100));

    try {
      let finalMarkdown = '';
      const stream = generateResumeStream(githubUrl, linkedinUrl, targetJob, additionalContext, resumeFile);
      
      for await (const chunk of stream) {
        if (chunk.type === 'status') {
          setGenerationStep(chunk.message);
        } else if (chunk.type === 'text' && chunk.text) {
          finalMarkdown += chunk.text;
          setResumeMarkdown(finalMarkdown);
        }
      }

      if (finalMarkdown) {
        setIsAnalyzing(true);
        setGenerationStep('Executing ATS intelligent scan...');
        let analysisResult: ResumeAnalysis | null = null;
        try {
          analysisResult = await analyzeResume(finalMarkdown, targetJob);
          setAtsScore(analysisResult);
        } catch (analysisErr) {
          console.error("Analysis failed during auto-generation:", analysisErr);
          setAnalysisError("Failed to calculate ATS score automatically.");
        } finally {
          setIsAnalyzing(false);
        }

        const newHistoryItem: ResumeHistoryItem = {
          id: `h_${Date.now()}`,
          timestamp: Date.now(),
          targetJob,
          githubUrl,
          linkedinUrl,
          additionalContext,
          resumeMarkdown: finalMarkdown,
          atsScore: analysisResult,
          resumeFileName: resumeFile?.name,
          resumeFileData: resumeFile?.data,
          resumeFileMimeType: resumeFile?.mimeType
        };
        saveToHistory(newHistoryItem);
        setActiveHistoryId(newHistoryItem.id);
      }
    } catch (err: any) {
      console.error("Error generating resume:", err);
      let errorMessage = "An unexpected error occurred while generating your resume. Please try again.";
      if (err?.message) {
        const msg = err.message.toLowerCase();
        if (msg.includes("api key") || msg.includes("key not valid")) {
          errorMessage = "Invalid or missing Gemini API key. Please check your environment configuration.";
        } else if (msg.includes("quota") || msg.includes("429")) {
          errorMessage = "API quota exceeded. Please try again later.";
        } else if (msg.includes("unsupported mime type") || msg.includes("invalid_argument")) {
          errorMessage = "Unsupported file type or invalid input. Please ensure you uploaded a PDF/TXT file and provided valid URLs.";
        } else if (msg.includes("network") || msg.includes("fetch") || msg.includes("failed to fetch")) {
          errorMessage = "Network error. Please check your internet connection and try again.";
        } else if (msg.includes("400") || msg.includes("bad request")) {
          errorMessage = "Bad request. The provided files or URLs might be too large or invalid.";
        } else {
          errorMessage = err.message;
        }
      }
      setError(errorMessage);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleReAnalyze = async () => {
    if (!resumeMarkdown) return;
    setIsAnalyzing(true);
    setAnalysisError(null);
    try {
      const analysisResult = await analyzeResume(resumeMarkdown, targetJob);
      setAtsScore(analysisResult);
      if (activeHistoryId) {
        updateHistoryScore(activeHistoryId, analysisResult);
      }
    } catch (err: any) {
      console.error("Re-analysis failed:", err);
      setAnalysisError("Failed to recalculate ATS score.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(resumeMarkdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    // Wrap markdown in simple HTML that Word recognizes
    // We replace newlines with breaks for basic formatting
    const htmlContent = `
      <html xmlns:o='urn:schemas-microsoft-com:office:office' 
            xmlns:w='urn:schemas-microsoft-com:office:word' 
            xmlns='http://www.w3.org/TR/REC-html40'>
      <head>
        <meta charset='utf-8'>
        <title>Resume</title>
        <style>
          body { font-family: 'Calibri', sans-serif; line-height: 1.5; }
          h1, h2, h3 { color: #2d3748; margin-top: 1.5em; }
          ul { margin-bottom: 1em; }
          li { margin-bottom: 0.5em; }
        </style>
      </head>
      <body>
        ${resumeMarkdown
          .replace(/^# (.*$)/gim, '<h1>$1</h1>')
          .replace(/^## (.*$)/gim, '<h2>$1</h2>')
          .replace(/^### (.*$)/gim, '<h3>$1</h3>')
          .replace(/^\s*\n/gm, '<br/>')
          .replace(/^\* (.*$)/gim, '<ul><li>$1</li></ul>')
          .replace(/<\/ul>\s*<ul>/g, '')
          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
          .split('\n').join('<br/>')}
      </body>
      </html>
    `;

    const blob = new Blob([htmlContent], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Resume_${targetJob.replace(/\s+/g, '_')}.doc`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 flex flex-col md:flex-row md:h-screen md:overflow-hidden transition-colors duration-300">
      {/* Left Pane: Input Form */}
      <div className="w-full md:w-[450px] lg:w-[500px] bg-white dark:bg-zinc-900 border-b md:border-b-0 md:border-r border-zinc-200 dark:border-zinc-800 p-6 md:p-8 flex flex-col md:h-screen md:overflow-y-auto shrink-0 transition-colors duration-300">
        <div className="mb-8 select-none">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-zinc-900 dark:bg-zinc-100 flex items-center justify-center transition-colors duration-300">
                <Sparkles className="w-4 h-4 text-white dark:text-zinc-900" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">Resume AI</h1>
            </div>
            {/* Theme Toggle Button */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0 rounded-full border border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors bg-transparent"
              onClick={() => setTheme(prev => prev === 'light' ? 'dark' : 'light')}
              title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
            >
              {theme === 'light' ? (
                <Moon className="w-4 h-4" />
              ) : (
                <Sun className="w-4 h-4 text-amber-400 animate-pulse" />
              )}
            </Button>
          </div>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Generate an ATS-friendly resume tailored to your target role using your GitHub and LinkedIn profiles.
          </p>
        </div>

        {/* Dynamic Navigation Tabs */}
        <div className="flex bg-zinc-100 dark:bg-zinc-800/80 p-1 rounded-xl mb-6 shrink-0 transition-colors duration-300">
          <button
            type="button"
            onClick={() => setActiveTab('create')}
            className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-bold rounded-lg transition-all ${
              activeTab === 'create'
                ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-sm border border-zinc-200 dark:border-zinc-850'
                : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            Generate Resume
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-bold rounded-lg transition-all ${
              activeTab === 'history'
                ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-sm border border-zinc-200 dark:border-zinc-850'
                : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            History ({historyList.length})
          </button>
        </div>

        {activeTab === 'create' ? (
          <form onSubmit={handleGenerate} className="space-y-6 flex-1 flex flex-col justify-between">
            <div className="space-y-4 flex-1">
              {activeHistoryId && (
                <div className="bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100/50 dark:border-blue-900/30 rounded-xl p-3 text-xs text-blue-800 dark:text-blue-300 flex items-center justify-between gap-2 mb-2 animate-fade-in">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <History className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                    <span className="truncate">Active session: <strong>Loaded from history</strong></span>
                  </div>
                  <Button 
                    type="button" 
                    variant="link" 
                    size="sm" 
                    className="text-blue-700 dark:text-blue-400 font-bold p-0 h-auto hover:text-blue-800 dark:hover:text-blue-300 shrink-0"
                    onClick={() => {
                      setActiveHistoryId(null);
                      setGithubUrl('');
                      setLinkedinUrl('');
                      setTargetJob('');
                      setAdditionalContext('');
                      setResumeMarkdown('');
                      setAtsScore(null);
                      setResumeFile(null);
                    }}
                  >
                    Reset Form
                  </Button>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="github" className="flex items-center gap-2">
                  <Github className="w-4 h-4" />
                  GitHub Profile URL
                </Label>
                <Input 
                  id="github" 
                  placeholder="https://github.com/username" 
                  value={githubUrl}
                  onChange={(e) => {
                    setGithubUrl(e.target.value);
                    if (urlErrors.github) setUrlErrors(prev => ({ ...prev, github: '' }));
                  }}
                  className={urlErrors.github ? "border-red-500 focus-visible:ring-red-500" : ""}
                />
                {urlErrors.github && <p className="text-xs text-red-500">{urlErrors.github}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="linkedin" className="flex items-center gap-2">
                  <Linkedin className="w-4 h-4" />
                  LinkedIn Profile URL
                </Label>
                <Input 
                  id="linkedin" 
                  placeholder="https://linkedin.com/in/username" 
                  value={linkedinUrl}
                  onChange={(e) => {
                    setLinkedinUrl(e.target.value);
                    if (urlErrors.linkedin) setUrlErrors(prev => ({ ...prev, linkedin: '' }));
                  }}
                  className={urlErrors.linkedin ? "border-red-500 focus-visible:ring-red-500" : ""}
                />
                {urlErrors.linkedin && <p className="text-xs text-red-500">{urlErrors.linkedin}</p>}
              </div>

              <Separator className="my-4" />

              <div className="space-y-2">
                <Label htmlFor="targetJob" className="flex items-center gap-2">
                  <Briefcase className="w-4 h-4" />
                  Target Job Title
                </Label>
                <Input 
                  id="targetJob" 
                  placeholder="e.g. Senior Frontend Engineer" 
                  value={targetJob}
                  onChange={(e) => setTargetJob(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="context" className="flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  Additional Context (Optional)
                </Label>
                <Textarea 
                  id="context" 
                  placeholder="Any specific achievements, keywords, or preferences you want to include..." 
                  className="resize-none h-24"
                  value={additionalContext}
                  onChange={(e) => setAdditionalContext(e.target.value)}
                />
              </div>

              <Separator className="my-4" />

              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  Current Resume (Optional)
                </Label>
                <div className="flex items-center gap-2">
                  <input 
                    type="file" 
                    accept=".pdf,.txt" 
                    className="hidden" 
                    ref={fileInputRef}
                    onChange={handleFileChange}
                  />
                  <Button 
                    type="button" 
                    variant="outline" 
                    className="w-full"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                  >
                    {isUploading ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Uploading...
                      </>
                    ) : (
                      <>
                        <Upload className="w-4 h-4 mr-2" />
                        Upload Resume
                      </>
                    )}
                  </Button>
                </div>
                {resumeFile && (
                  <div className="flex items-center justify-between p-2 mt-2 text-sm border rounded-md bg-zinc-50 dark:bg-zinc-800/60 border-zinc-200 dark:border-zinc-700">
                    <span className="truncate max-w-[200px]">{resumeFile.name}</span>
                    <Button type="button" variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={handleRemoveFile}>
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                )}
              </div>
            </div>

            <Button 
              type="submit" 
              className="w-full h-12 text-base font-medium relative overflow-hidden transition-all duration-300 mt-6 active:scale-[0.98] shrink-0"
              disabled={isGenerating || (!githubUrl && !linkedinUrl && !resumeFile) || !targetJob}
            >
              <div className="flex items-center justify-center">
                {isGenerating ? (
                  <motion.div 
                    key="loading"
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ type: "spring", stiffness: 300, damping: 25 }}
                    className="flex items-center gap-2"
                  >
                    <Loader2 className="w-5 h-5 animate-spin text-current" />
                    <span>Analyzing Profiles...</span>
                  </motion.div>
                ) : (
                  <motion.div 
                    key="idle"
                    initial={{ opacity: 0, y: -15 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ type: "spring", stiffness: 300, damping: 25 }}
                    className="flex items-center gap-2"
                  >
                    <span>Generate Resume</span>
                    <Sparkles className="w-4 h-4 text-current animate-pulse" />
                  </motion.div>
                )}
              </div>
            </Button>
          </form>
        ) : (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 font-sans">Saved Resumes</h3>
              {historyList.length > 0 && (
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="text-xs text-zinc-500 dark:text-zinc-400 hover:text-red-600 dark:hover:text-red-400 font-semibold p-0 h-auto bg-transparent hover:bg-transparent"
                  onClick={() => {
                    if (window.confirm("Are you sure you want to clear your entire generation history? This action is irreversible.")) {
                      setHistoryList([]);
                      localStorage.removeItem('resume_generation_history');
                      setActiveHistoryId(null);
                    }
                  }}
                >
                  Clear All
                </Button>
              )}
            </div>

            {historyList.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center p-8 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-2xl text-center bg-zinc-50/50 dark:bg-zinc-900/20">
                <History className="w-8 h-8 text-zinc-300 dark:text-zinc-700 mb-3" />
                <h4 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 font-heading">No history yet</h4>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 max-w-[240px] font-sans">
                  Resumes you generate will appear here so you can quickly retrieve or rebuild them.
                </p>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => setActiveTab('create')} 
                  className="mt-4 text-xs font-semibold"
                >
                  Generate One Now
                </Button>
              </div>
            ) : (
              <div className="space-y-3 overflow-y-auto pr-1 flex-1 pb-6 max-h-[calc(100vh-280px)] md:max-h-none">
                {historyList.map((item) => {
                  const isSelected = activeHistoryId === item.id;
                  const dateStr = new Date(item.timestamp).toLocaleDateString([], { 
                    month: 'short', 
                    day: 'numeric', 
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  });
                  return (
                    <motion.div
                      key={item.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`group relative p-4 rounded-xl border text-left cursor-pointer transition-all ${
                        isSelected 
                          ? 'bg-zinc-900 dark:bg-zinc-105 text-white dark:text-zinc-950 border-zinc-900 dark:border-zinc-100 shadow-md ring-2 ring-zinc-900 dark:ring-zinc-100 ring-offset-2 dark:ring-offset-zinc-900' 
                          : 'bg-white dark:bg-zinc-800/40 hover:bg-zinc-50 dark:hover:bg-zinc-800/80 border-zinc-200 dark:border-zinc-800'
                      }`}
                      onClick={() => {
                        loadHistoryItem(item);
                        setActiveTab('create');
                      }}
                    >
                      <div className="pr-8 space-y-1.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`text-[10px] uppercase font-extrabold tracking-widest px-2.5 py-0.5 rounded-full border ${
                            isSelected 
                              ? 'bg-zinc-800 dark:bg-zinc-200/50 text-zinc-200 dark:text-zinc-800 border-zinc-700 dark:border-zinc-300' 
                              : item.atsScore 
                                ? item.atsScore.score >= 85 
                                  ? 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 border-emerald-100 dark:border-emerald-900/30' 
                                  : item.atsScore.score >= 70
                                    ? 'bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 border-amber-100 dark:border-amber-900/30'
                                    : 'bg-rose-50 dark:bg-rose-950/20 text-rose-700 dark:text-rose-400 border-rose-100 dark:border-rose-900/30'
                                : 'bg-zinc-50 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 border-zinc-100 dark:border-zinc-700/50'
                          }`}>
                            {item.atsScore ? `Score: ${item.atsScore.score}` : 'No Score'}
                          </span>
                          {item.resumeFileName && (
                            <span className={`text-[9px] font-medium px-2 py-0.5 rounded border max-w-[124px] truncate ${
                              isSelected 
                                ? 'bg-zinc-800 dark:bg-zinc-200/50 text-zinc-300 dark:text-zinc-800 border-zinc-700 dark:border-zinc-300' 
                                : 'bg-blue-50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400 border-blue-100 dark:border-blue-900/30'
                            }`}>
                              📄 {item.resumeFileName}
                            </span>
                          )}
                        </div>
                        <h4 className={`text-sm font-bold truncate ${isSelected ? 'text-white dark:text-zinc-950' : 'text-zinc-900 dark:text-zinc-100'}`}>
                          {item.targetJob}
                        </h4>
                        <div className={`flex items-center gap-3 text-[10px] ${isSelected ? 'text-zinc-400 dark:text-zinc-600' : 'text-zinc-500 dark:text-zinc-400'}`}>
                          <span className="flex items-center gap-1 shrink-0">
                            <Calendar className="w-3 h-3" />
                            {dateStr}
                          </span>
                          {(item.githubUrl || item.linkedinUrl) && (
                            <span className="truncate flex-1">
                              {item.githubUrl && 'GitHub'}
                              {item.githubUrl && item.linkedinUrl && ' + '}
                              {item.linkedinUrl && 'LinkedIn'}
                            </span>
                          )}
                        </div>
                      </div>
                      
                      <Button
                        variant="ghost"
                        size="sm"
                        className={`absolute right-2 top-2 h-7 w-7 p-0 rounded-lg shrink-0 ${
                          isSelected 
                            ? 'text-zinc-400 dark:text-zinc-600 hover:text-white dark:hover:text-zinc-950 hover:bg-zinc-800 dark:hover:bg-zinc-200' 
                            : 'text-zinc-400 dark:text-zinc-500 hover:text-red-500 dark:hover:text-red-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                        }`}
                        onClick={(e) => deleteHistoryItem(item.id, e)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right Pane: Preview */}
      <div className="flex-1 bg-zinc-50 dark:bg-zinc-950 flex flex-col min-h-[500px] md:h-screen md:overflow-hidden transition-colors duration-300">
        {error ? (
          <div className="flex-1 flex items-center justify-center p-6 text-center">
            <div className="max-w-md space-y-6 w-full animate-fade-in">
              <div className="w-16 h-16 bg-red-50 dark:bg-red-950/20 rounded-2xl mx-auto flex items-center justify-center border border-red-100 dark:border-red-900/40">
                <AlertCircle className="w-8 h-8 text-red-500 dark:text-red-400" />
              </div>
              <div className="space-y-4">
                <h3 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 font-heading">Generation Failed</h3>
                <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/10 p-4 rounded-lg border border-red-105 dark:border-red-900/30 text-left font-sans">
                  {error}
                </div>
                <Button variant="outline" onClick={() => setError(null)} className="mt-2 text-xs font-semibold">
                  Dismiss
                </Button>
              </div>
            </div>
          </div>
        ) : isGenerating && !resumeMarkdown ? (
          <div className="flex-1 flex flex-col h-full bg-zinc-50 dark:bg-zinc-950 overflow-hidden">
            {/* Loading Header */}
            <div className="h-16 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-6 flex items-center justify-between shrink-0 transition-colors duration-300">
              <div className="flex items-center gap-3">
                <h2 className="font-semibold text-zinc-900 dark:text-zinc-100 italic font-heading">Synthesizing...</h2>
                <span className="flex items-center text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/20 px-2.5 py-1 rounded-full border border-blue-100 dark:border-blue-900/30">
                  <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                  {generationStep}
                </span>
              </div>
            </div>

            <div className="flex-1 p-6 md:p-12 overflow-y-auto">
              <div className="max-w-3xl mx-auto space-y-8">
                {/* Progress Indicator */}
                <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 rounded-xl shadow-sm space-y-4 transition-colors duration-300">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 font-sans">Intelligence Pipeline</span>
                    <span className="text-xs font-bold text-blue-500 font-sans">Processing...</span>
                  </div>
                  <div className="w-full h-2 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden relative">
                    <motion.div 
                      className="h-full bg-blue-500"
                      initial={{ width: "0%" }}
                      animate={{ width: "95%" }}
                      transition={{ duration: 30, ease: "linear" }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] uppercase tracking-wider font-bold text-zinc-400 dark:text-zinc-500 font-sans">
                    <span className={generationStep.includes('Scanning') || generationStep.includes('Extracting') ? 'text-blue-500' : ''}>Extraction</span>
                    <span className={generationStep.includes('Synthesizing') ? 'text-blue-500' : ''}>Synthesis</span>
                    <span className="text-zinc-300 dark:text-zinc-750">ATS Optimization</span>
                  </div>
                </div>

                 {/* Resume Skeleton */}
                <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xl rounded-2xl p-6 md:p-10 space-y-6 animate-pulse transition-colors duration-300">
                  {/* Header Skeleton Centered */}
                  <div className="space-y-3 pb-4 border-b border-zinc-100 dark:border-zinc-800 flex flex-col items-center">
                    <div className="h-8 bg-zinc-100 dark:bg-zinc-800 rounded-md w-1/2"></div>
                    <div className="h-4 bg-zinc-55 dark:bg-zinc-800/50 rounded w-2/3"></div>
                  </div>

                  {/* Skills Skeleton */}
                  <div className="space-y-2 pb-2 border-b border-zinc-100 dark:border-zinc-800">
                    <div className="h-4 bg-zinc-100 dark:bg-zinc-800 rounded w-16"></div>
                    <div className="space-y-1.5">
                      <div className="h-3 bg-zinc-50 dark:bg-zinc-800/50 rounded w-full"></div>
                      <div className="h-3 bg-zinc-50 dark:bg-zinc-800/50 rounded w-5/6"></div>
                    </div>
                  </div>

                  {/* Experience Skeleton */}
                  <div className="space-y-4">
                    <div className="h-4 bg-zinc-100 dark:bg-zinc-800 rounded w-32 border-b border-zinc-100 dark:border-zinc-800 pb-1 font-sans"></div>
                    {[1, 2].map(i => (
                      <div key={i} className="space-y-2">
                        <div className="flex justify-between">
                          <div className="h-4 bg-zinc-100 dark:bg-zinc-800 rounded w-2/5"></div>
                          <div className="h-3.5 bg-zinc-50 dark:bg-zinc-800/50 rounded w-16"></div>
                        </div>
                        <div className="space-y-1.5 pl-2 border-l-2 border-zinc-100 dark:border-zinc-800">
                          <div className="h-2.5 bg-zinc-55 dark:bg-zinc-800/50 rounded w-full"></div>
                          <div className="h-2.5 bg-zinc-55 dark:bg-zinc-800/50 rounded w-full"></div>
                          <div className="h-2.5 bg-zinc-55 dark:bg-zinc-800/50 rounded w-11/12"></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : resumeMarkdown ? (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex-1 flex flex-col h-full"
          >
            <div className="h-16 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-6 flex items-center justify-between shrink-0 transition-colors duration-300">
              <div className="flex items-center gap-3">
                <h2 className="font-semibold text-zinc-900 dark:text-zinc-50 font-heading">Generated Resume</h2>
                {isGenerating && (
                  <span className="flex items-center text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/20 px-2.5 py-1 rounded-full border border-blue-105 dark:border-blue-900/30">
                    <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                    {generationStep}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {atsScore && !isAnalyzing && atsScore.matchingKeywords && atsScore.matchingKeywords.length > 0 && (
                  <Button 
                    variant={isHighlightingKeywords ? "default" : "outline"} 
                    size="sm" 
                    onClick={() => setIsHighlightingKeywords(!isHighlightingKeywords)}
                    className={`text-xs font-medium gap-1.5 transition-all ${
                      isHighlightingKeywords 
                        ? 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600 shadow-sm' 
                        : 'text-zinc-600 dark:text-zinc-300 hover:text-emerald-600 dark:hover:text-emerald-400 border-zinc-200 dark:border-zinc-800'
                    }`}
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    {isHighlightingKeywords ? 'Highlight On' : 'Highlight Matches'}
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={handleDownload} className="text-xs font-semibold">
                  <Download className="w-4 h-4 mr-2" />
                  Download .doc
                </Button>
                <Button variant="outline" size="sm" onClick={handleCopy} className="text-xs font-semibold">
                  {copied ? <CheckCircle2 className="w-4 h-4 mr-2 text-green-600 dark:text-green-400" /> : <Copy className="w-4 h-4 mr-2" />}
                  {copied ? 'Copied!' : 'Copy Markdown'}
                </Button>
              </div>
            </div>
            <div className="flex-1 p-6 md:p-12 overflow-y-auto">
              <div className="max-w-3xl mx-auto space-y-8">
                {/* Scorecard Skeleton Loader */}
                {isAnalyzing && (
                  <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-sm p-6 md:p-8 space-y-6 animate-pulse" id="ats-scorecard-skeleton">
                    <div className="flex justify-between items-center pb-4 border-b border-zinc-100 dark:border-zinc-800">
                      <div className="space-y-2">
                        <div className="h-5 bg-zinc-100 dark:bg-zinc-800 rounded w-48"></div>
                        <div className="h-3 bg-zinc-50 dark:bg-zinc-800/50 rounded w-64"></div>
                      </div>
                      <div className="h-8 bg-zinc-100 dark:bg-zinc-800 rounded w-24"></div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6 items-center">
                      <div className="flex flex-col items-center justify-center space-y-3 md:border-r border-zinc-100 dark:border-zinc-800 md:pr-6">
                        <div className="w-16 h-16 border-4 border-zinc-100 dark:border-zinc-800 border-t-zinc-400 dark:border-t-zinc-500 rounded-full animate-spin"></div>
                        <div className="h-5 bg-zinc-100 dark:bg-zinc-800 rounded w-20"></div>
                      </div>
                      <div className="md:col-span-3 space-y-4">
                        <div className="h-4 bg-zinc-100 dark:bg-zinc-800 rounded w-3/4"></div>
                        <div className="space-y-2">
                          <div className="h-3 bg-zinc-50 dark:bg-zinc-800/50 rounded w-full"></div>
                          <div className="h-3 bg-zinc-50 dark:bg-zinc-800/50 rounded w-full"></div>
                          <div className="h-3 bg-zinc-50 dark:bg-zinc-800/50 rounded w-2/3"></div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Scorecard Component */}
                {atsScore && !isAnalyzing && (
                  <motion.div 
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-sm p-6 md:p-8 space-y-6 transition-colors duration-300"
                    id="ats-scorecard"
                  >
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-zinc-100 dark:border-zinc-800">
                      <div>
                        <h3 className="text-lg font-bold font-heading text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
                          <Sparkles className="w-5 h-5 text-blue-500 animate-pulse" />
                          ATS Scorecard & Optimization
                        </h3>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">Real-time analysis against professional ATS requirements for {targetJob}</p>
                      </div>
                      <div className="flex items-center gap-2 self-stretch sm:self-auto justify-end">
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={handleReAnalyze}
                          disabled={isAnalyzing}
                          className="text-xs font-medium text-zinc-600 hover:text-blue-600 gap-1.5"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          Re-evaluate
                        </Button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6 items-center">
                      {/* Score gauge */}
                      <div className="flex flex-col items-center justify-center md:border-r border-zinc-100 dark:border-zinc-800 md:pr-6 py-2">
                        <div className="relative w-24 h-24 flex items-center justify-center">
                          {/* SVG ring background */}
                          <svg className="absolute w-full h-full transform -rotate-90">
                            <circle
                              cx="48"
                              cy="48"
                              r="40"
                              stroke="currentColor"
                              className="text-zinc-100 dark:text-zinc-800"
                              strokeWidth="8"
                              fill="transparent"
                            />
                            <motion.circle
                              cx="48"
                              cy="48"
                              r="40"
                              stroke={
                                atsScore.score >= 85 ? "#10b981" : 
                                atsScore.score >= 70 ? "#f59e0b" : 
                                "#ef4444"
                              }
                              strokeWidth="8"
                              fill="transparent"
                              strokeDasharray={251.2}
                              initial={{ strokeDashoffset: 251.2 }}
                              animate={{ strokeDashoffset: 251.2 - (251.2 * atsScore.score) / 100 }}
                              transition={{ duration: 1.2, ease: "easeOut" }}
                            />
                          </svg>
                          <span className="text-2xl font-black font-heading tracking-tight text-zinc-900 dark:text-zinc-50">
                            {atsScore.score}
                          </span>
                        </div>
                        <div className="mt-2 text-center">
                          <span className={`text-[10px] font-extrabold uppercase tracking-widest px-2.5 py-0.5 rounded-full border ${
                            atsScore.score >= 85 ? "bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 border-emerald-100 dark:border-emerald-900/30" : 
                            atsScore.score >= 70 ? "bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 border-amber-100 dark:border-amber-900/30" : 
                            "bg-rose-50 dark:bg-rose-950/20 text-rose-700 dark:text-rose-400 border-rose-100 dark:border-rose-900/30"
                          }`}>
                            {atsScore.score >= 85 ? "Strong Match" : 
                             atsScore.score >= 70 ? "Good Candidate" : 
                             "Needs Tuning"}
                          </span>
                        </div>
                      </div>

                      {/* Summary and improvements */}
                      <div className="md:col-span-3 space-y-4">
                        <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed font-sans italic border-l-2 border-zinc-200 dark:border-zinc-800 pl-4">
                          "{atsScore.summary}"
                        </p>
                                              <div className="space-y-3">
                          <h4 className="text-xs font-bold uppercase tracking-widest text-zinc-400 dark:text-zinc-500 font-sans">Actionable Recommendations:</h4>
                          <ul className="space-y-2.5">
                            {atsScore.improvements.map((improvement, index) => {
                              const parts = improvement.split('**');
                              if (parts.length >= 3) {
                                const category = parts[1];
                                const detail = parts.slice(2).join('**');
                                return (
                                  <motion.li 
                                    key={index} 
                                    initial={{ opacity: 0, x: 10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: index * 0.1 }}
                                    className="flex items-start gap-2 text-xs md:text-sm text-zinc-650 dark:text-zinc-400 leading-relaxed font-sans"
                                  >
                                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-500 dark:bg-blue-400 shrink-0" />
                                    <span>
                                      <strong className="text-zinc-800 dark:text-zinc-200 font-bold">{category}</strong>
                                      {detail}
                                    </span>
                                  </motion.li>
                                );
                              }
                              return (
                                <motion.li 
                                  key={index}
                                  initial={{ opacity: 0, x: 10 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  transition={{ delay: index * 0.1 }}
                                  className="flex items-start gap-2 text-xs md:text-sm text-zinc-650 dark:text-zinc-400 leading-relaxed font-sans"
                                >
                                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-500 dark:bg-blue-400 shrink-0" />
                                  <span>{improvement}</span>
                                </motion.li>
                              );
                            })}
                          </ul>
                        </div>
                      </div>
                    </div>

                    <Separator className="border-zinc-100 dark:border-zinc-800" />
                    
                    <div className="space-y-4 pt-1 animate-fade-in" id="recommended-keywords-checklist">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-zinc-50/50 dark:bg-zinc-800/10 p-2.5 rounded-xl border border-zinc-100 dark:border-zinc-800">
                        <div className="space-y-0.5">
                          <h4 className="text-sm font-bold tracking-tight text-zinc-900 dark:text-zinc-50 flex items-center gap-1.5 font-heading">
                            <Sparkles className="w-4 h-4 text-amber-500 animate-pulse" />
                            Target Role Keywords Analysis
                          </h4>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400">
                            Core technical term alignment optimized for <span className="font-semibold text-zinc-700 dark:text-zinc-300">"{targetJob}"</span>.
                          </p>
                        </div>
                        {atsScore.matchingKeywords && atsScore.matchingKeywords.length > 0 && (
                          <div className="flex items-center gap-2 px-2 py-1 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 shadow-sm self-start sm:self-auto select-none transition-colors duration-300">
                            <span className="text-xs text-zinc-600 dark:text-zinc-400 font-medium font-sans">Highlight matches:</span>
                            <button
                              type="button"
                              onClick={() => setIsHighlightingKeywords(!isHighlightingKeywords)}
                              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${isHighlightingKeywords ? 'bg-emerald-500' : 'bg-zinc-200 dark:bg-zinc-800'}`}
                            >
                              <span
                                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white dark:bg-zinc-300 shadow ring-0 transition duration-200 ease-in-out ${isHighlightingKeywords ? 'translate-x-4' : 'translate-x-0'}`}
                              />
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Missing Keywords Column */}
                        <div className="p-4 bg-rose-50/20 dark:bg-rose-950/10 border border-rose-100 dark:border-rose-900/30 rounded-xl space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 text-rose-800 dark:text-rose-400 font-bold text-xs uppercase tracking-wider font-sans">
                              <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                              Missing Recommended ({atsScore.missingKeywords?.length || 0})
                            </div>
                            <span className="text-[10px] text-rose-600 dark:text-rose-405 bg-rose-50 dark:bg-rose-950/30 px-2 py-0.5 rounded-full font-bold font-sans border border-rose-100/55 dark:border-rose-900/30">
                              Fix to boost score
                            </span>
                          </div>
                          
                          {(!atsScore.missingKeywords || atsScore.missingKeywords.length === 0) ? (
                            <p className="text-xs text-emerald-700 dark:text-emerald-405 font-sans italic font-medium">🎉 Flawless Match! All key industry requirements are represented.</p>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {atsScore.missingKeywords.map((kw, i) => (
                                <span 
                                  key={i} 
                                  className="text-xs text-rose-900 dark:text-rose-200 bg-rose-105/40 hover:bg-rose-100 dark:bg-rose-950/20 dark:hover:bg-rose-955/40 px-2.5 py-1 rounded-lg font-medium border border-rose-100/70 dark:border-rose-900/30 flex items-center gap-1 transition-all"
                                  title="Missing critical keyword - try weaving this term organically into your work history or expertise list"
                                >
                                  <span className="text-rose-500 dark:text-rose-450 font-bold leading-none text-base">+</span>
                                  {kw}
                                </span>
                              ))}
                            </div>
                          )}
                          <p className="text-[10px] text-rose-600/90 dark:text-rose-400/85 leading-relaxed font-sans">
                            ATS bots rely on keyword match ratios. If you possess these skills, consider writing them into your certifications, projects, or job summaries to dramatically raise parsing frequency.
                          </p>
                        </div>

                        {/* Present Keywords Column */}
                        <div className="p-4 bg-emerald-50/20 dark:bg-emerald-950/10 border border-emerald-100 dark:border-emerald-900/30 rounded-xl space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 text-emerald-800 dark:text-emerald-400 font-bold text-xs uppercase tracking-wider font-sans">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                              Identified Matches ({atsScore.matchingKeywords?.length || 0})
                            </div>
                            <span className="text-[10px] text-emerald-600 dark:text-emerald-405 bg-emerald-50 dark:bg-emerald-950/30 px-2 py-0.5 rounded-full font-bold font-sans border border-emerald-100/55 dark:border-emerald-900/30">
                              Active in resume
                            </span>
                          </div>

                          {(!atsScore.matchingKeywords || atsScore.matchingKeywords.length === 0) ? (
                            <p className="text-xs text-zinc-500 dark:text-zinc-400 font-sans italic">No direct matches identified yet. Ensure profile keywords are correctly spelled.</p>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {atsScore.matchingKeywords.map((kw, i) => (
                                <span 
                                  key={i} 
                                  className="text-xs text-emerald-900 dark:text-emerald-200 bg-emerald-100/40 hover:bg-emerald-100 dark:bg-emerald-950/20 dark:hover:bg-emerald-955/40 px-2.5 py-1 rounded-lg font-medium border border-emerald-100/70 dark:border-emerald-900/30 flex items-center gap-1.5 transition-all"
                                >
                                  <span className="text-emerald-600 dark:text-emerald-450 font-bold leading-none">✓</span>
                                  {kw}
                                </span>
                              ))}
                            </div>
                          )}
                          <p className="text-[10px] text-emerald-600/90 dark:text-emerald-400/85 leading-relaxed font-sans">
                            We successfully scanned these matching prerequisites in your resume document. These terms will score highly under candidate-to-tier alignment assessments.
                          </p>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}

                {/* Analysis Error State */}
                {analysisError && (
                  <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-600 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                    <span>{analysisError}</span>
                    <Button variant="link" size="sm" onClick={handleReAnalyze} className="text-red-700 p-0 h-auto font-semibold ml-auto">
                      Retry Scan
                    </Button>
                  </div>
                )}

                <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-md rounded-2xl p-6 md:p-10 transition-colors duration-300 hover:shadow-lg">
                <div className="prose prose-zinc dark:prose-invert max-w-none prose-a:text-blue-600 dark:prose-a:text-blue-400">
                  <Markdown 
                    remarkPlugins={[remarkGfm, remarkBreaks]}
                    rehypePlugins={[rehypeRaw, rehypeSanitize]}
                    components={{
                      h1: ({ children }) => (
                        <motion.h1 
                          initial={{ opacity: 0, y: -5 }}
                          animate={{ opacity: 1, y: 0 }}
                          viewport={{ once: true }}
                          className="text-3xl font-heading font-black text-center text-zinc-900 dark:text-zinc-50 tracking-tight mb-2 border-none pb-0"
                        >
                          {children}
                        </motion.h1>
                      ),
                      h2: ({ children }) => (
                        <motion.h2 
                          initial={{ opacity: 0, y: 5 }}
                          whileInView={{ opacity: 1, y: 0 }}
                          viewport={{ once: true }}
                          transition={{ delay: 0.05 }}
                          className="text-xs font-heading font-bold uppercase tracking-wider mt-6 mb-2 text-zinc-900 dark:text-zinc-50 border-b border-zinc-200 dark:border-zinc-800 pb-1 flex items-center justify-between"
                        >
                          {children}
                        </motion.h2>
                      ),
                      h3: ({ children }) => (
                        <motion.h3 
                          initial={{ opacity: 0, y: 3 }}
                          whileInView={{ opacity: 1, y: 0 }}
                          viewport={{ once: true }}
                          className="text-xs font-heading font-semibold mt-3 mb-1 text-zinc-800 dark:text-zinc-200 flex justify-between items-center flex-wrap gap-2"
                        >
                          {children}
                        </motion.h3>
                      ),
                      p: ({ children }) => {
                        const serializedChildren = Array.isArray(children) 
                          ? children.map(c => (typeof c === 'object' && c !== null && 'props' in c ? (c.props?.children || '') : String(c))).join('')
                          : String(children);
                        const isContact = serializedChildren.includes('|') || serializedChildren.includes('@');
                        
                        if (isContact) {
                          return (
                            <p className="text-[11px] text-zinc-650 dark:text-zinc-400 font-sans text-center tracking-tight mb-4 -mt-1 pb-2 border-b border-zinc-100 dark:border-zinc-800 flex flex-wrap justify-center items-center gap-1.5 leading-normal">
                              {children}
                            </p>
                          );
                        }
                        return <p className="mb-2 text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-350 font-sans">{children}</p>;
                      },
                      ul: ({ children }) => <ul className="list-disc list-outside ml-4 mb-3 space-y-1 text-zinc-600 dark:text-zinc-350 font-sans text-[11px]">{children}</ul>,
                      ol: ({ children }) => <ol className="list-decimal list-outside ml-4 mb-3 space-y-1 text-zinc-600 dark:text-zinc-350 font-sans text-[11px]">{children}</ol>,
                      li: ({ children }) => <li className="pl-0.5 leading-relaxed text-zinc-650 dark:text-zinc-350">{children}</li>,
                      blockquote: ({ children }) => (
                        <blockquote className="border-l-4 border-zinc-900 dark:border-zinc-600 italic pl-6 my-8 text-zinc-700 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-805/40 py-4 rounded-r-lg font-sans">
                          {children}
                        </blockquote>
                      ),
                      table: ({ children }) => (
                        <div className="overflow-x-auto my-8 rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden shadow-sm">
                          <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-800">
                            {children}
                          </table>
                        </div>
                      ),
                      thead: ({ children }) => <thead className="bg-zinc-50 dark:bg-zinc-800 font-heading">{children}</thead>,
                      th: ({ children }) => <th className="px-6 py-4 text-left text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest">{children}</th>,
                      td: ({ children }) => <td className="px-6 py-4 text-sm text-zinc-605 dark:text-zinc-350 border-t border-zinc-100 dark:border-zinc-800/80 font-sans">{children}</td>,
                      a: ({ children, href }) => (
                        <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-405 hover:text-blue-700 dark:hover:text-blue-300 underline underline-offset-4 decoration-2 decoration-blue-100 dark:decoration-blue-900/40 hover:decoration-blue-300 transition-all inline-flex items-center gap-1 font-medium">
                          {children}
                        </a>
                      ),
                      code({ className, children, ref, node, ...rest }) {
                        const match = /language-(\w+)/.exec(className || '');
                        const isInline = !match;
                        return !isInline ? (
                          <div className="relative group my-6">
                            <div className="absolute right-3 top-3 opacity-0 group-hover:opacity-100 transition-opacity">
                              <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 bg-zinc-100/50 px-2 py-1 rounded backdrop-blur-sm">
                                {match[1]}
                              </span>
                            </div>
                            <SyntaxHighlighter
                              {...(rest as any)}
                              PreTag="div"
                              children={String(children).replace(/\n$/, '')}
                              language={match[1]}
                              style={vscDarkPlus}
                              className="!rounded-xl !p-6 !m-0 !bg-zinc-900 border border-zinc-800 shadow-lg text-sm"
                              customStyle={{
                                background: '#18181b', // zinc-900
                                margin: 0,
                              }}
                            />
                          </div>
                        ) : (
                          <code {...rest} ref={ref} className={`${className || ''} bg-zinc-100 dark:bg-zinc-805 text-zinc-900 dark:text-zinc-100 px-1.5 py-0.5 rounded font-mono text-[0.9em] border border-zinc-200 dark:border-zinc-800`}>
                            {children}
                          </code>
                        );
                      }
                    }}
                  >
                    {isHighlightingKeywords && atsScore?.matchingKeywords 
                      ? highlightKeywords(resumeMarkdown, atsScore.matchingKeywords) 
                      : resumeMarkdown}
                  </Markdown>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
        ) : (
          <div className="flex-1 flex items-center justify-center p-6 text-center">
            <div className="max-w-md space-y-6">
              <div className="w-16 h-16 bg-zinc-100 dark:bg-zinc-900 border border-zinc-100/70 dark:border-zinc-800 rounded-2xl mx-auto flex items-center justify-center">
                <FileText className="w-8 h-8 text-zinc-400 dark:text-zinc-500 animate-pulse" />
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 font-heading">No Resume Generated Yet</h3>
                <p className="text-zinc-500 dark:text-zinc-400 text-sm leading-relaxed font-sans">
                  Fill out the form on the left with your profile links and target role. Our AI will analyze your public presence and craft an ATS-optimized resume.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
