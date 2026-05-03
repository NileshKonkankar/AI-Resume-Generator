import { useState, useRef } from 'react';
import { motion } from 'motion/react';
import { Github, Linkedin, Briefcase, FileText, Loader2, Copy, CheckCircle2, Sparkles, Upload, X, AlertCircle, Download } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { generateResumeStream, ResumeFile } from './services/gemini';

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

    if (githubUrl && !/^https?:\/\/(www\.)?github\.com\/[A-Za-z0-9_.-]+\/?.*$/.test(githubUrl)) {
      errors.github = 'Please enter a valid GitHub profile URL (e.g., https://github.com/username)';
      isValid = false;
    }

    if (linkedinUrl && !/^https?:\/\/([a-z]{2,3}\.)?linkedin\.com\/in\/[A-Za-z0-9_.-]+\/?.*$/.test(linkedinUrl)) {
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
    try {
      const stream = generateResumeStream(githubUrl, linkedinUrl, targetJob, additionalContext, resumeFile);
      
      for await (const chunk of stream) {
        if (chunk.type === 'status') {
          setGenerationStep(chunk.message);
        } else if (chunk.type === 'text' && chunk.text) {
          setResumeMarkdown(prev => prev + chunk.text);
        }
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
    <div className="min-h-screen bg-zinc-50 text-zinc-900 flex flex-col md:flex-row md:h-screen md:overflow-hidden">
      {/* Left Pane: Input Form */}
      <div className="w-full md:w-[450px] lg:w-[500px] bg-white border-b md:border-b-0 md:border-r border-zinc-200 p-6 md:p-8 flex flex-col md:h-screen md:overflow-y-auto shrink-0">
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-zinc-900 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Resume AI</h1>
          </div>
          <p className="text-sm text-zinc-500">
            Generate an ATS-friendly resume tailored to your target role using your GitHub and LinkedIn profiles.
          </p>
        </div>

        <form onSubmit={handleGenerate} className="space-y-6 flex-1">
          <div className="space-y-4">
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
                <div className="flex items-center justify-between p-2 mt-2 text-sm border rounded-md bg-zinc-50 border-zinc-200">
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
            className="w-full h-12 text-base font-medium"
            disabled={isGenerating || (!githubUrl && !linkedinUrl && !resumeFile) || !targetJob}
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Analyzing Profiles...
              </>
            ) : (
              <>
                Generate Resume
                <Sparkles className="w-4 h-4 ml-2" />
              </>
            )}
          </Button>
        </form>
      </div>

      {/* Right Pane: Preview */}
      <div className="flex-1 bg-zinc-50 flex flex-col min-h-[500px] md:h-screen md:overflow-hidden">
        {error ? (
          <div className="flex-1 flex items-center justify-center p-6 text-center">
            <div className="max-w-md space-y-6 w-full">
              <div className="w-16 h-16 bg-red-50 rounded-2xl mx-auto flex items-center justify-center border border-red-100">
                <AlertCircle className="w-8 h-8 text-red-500" />
              </div>
              <div className="space-y-4">
                <h3 className="text-xl font-semibold text-zinc-900">Generation Failed</h3>
                <div className="text-sm text-red-600 bg-red-50 p-4 rounded-lg border border-red-100 text-left">
                  {error}
                </div>
                <Button variant="outline" onClick={() => setError(null)} className="mt-2">
                  Dismiss
                </Button>
              </div>
            </div>
          </div>
        ) : isGenerating && !resumeMarkdown ? (
          <div className="flex-1 flex items-center justify-center p-6 text-center">
            <div className="max-w-md space-y-6 w-full">
              <div className="w-16 h-16 bg-blue-50 rounded-2xl mx-auto flex items-center justify-center border border-blue-100">
                <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
              </div>
              <div className="space-y-4">
                <h3 className="text-xl font-semibold text-zinc-900">{generationStep}</h3>
                <p className="text-zinc-500">
                  We're cross-referencing your profiles to build a high-impact narrative.
                </p>
                <div className="w-full h-2 bg-zinc-100 rounded-full overflow-hidden relative">
                  <motion.div 
                    className="h-full bg-blue-500"
                    initial={{ width: "0%" }}
                    animate={{ width: "95%" }}
                    transition={{ duration: 25, ease: "linear" }}
                  />
                </div>
                <div className="flex justify-between text-[10px] uppercase tracking-wider font-bold text-zinc-400">
                  <span className={generationStep.includes('GitHub') ? 'text-blue-500' : ''}>Extracting</span>
                  <span className={generationStep.includes('Synthesizing') ? 'text-blue-500' : ''}>Structuring</span>
                  <span className={resumeMarkdown ? 'text-blue-500' : ''}>Rendering</span>
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
            <div className="h-16 border-b border-zinc-200 bg-white px-6 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <h2 className="font-semibold text-zinc-900">Generated Resume</h2>
                {isGenerating && (
                  <span className="flex items-center text-xs font-medium text-blue-600 bg-blue-50 px-2.5 py-1 rounded-full border border-blue-100">
                    <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                    {generationStep}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={handleDownload}>
                  <Download className="w-4 h-4 mr-2" />
                  Download .doc
                </Button>
                <Button variant="outline" size="sm" onClick={handleCopy}>
                  {copied ? <CheckCircle2 className="w-4 h-4 mr-2 text-green-600" /> : <Copy className="w-4 h-4 mr-2" />}
                  {copied ? 'Copied!' : 'Copy Markdown'}
                </Button>
              </div>
            </div>
            <div className="flex-1 p-6 md:p-12 overflow-y-auto">
              <div className="max-w-3xl mx-auto bg-white border border-zinc-200 shadow-sm rounded-xl p-8 md:p-12">
                <div className="prose prose-zinc max-w-none prose-headings:font-semibold prose-a:text-blue-600">
                  <Markdown 
                    remarkPlugins={[remarkGfm]}
                    components={{
                      code({ className, children, ref, node, ...rest }) {
                        const match = /language-(\w+)/.exec(className || '');
                        const isInline = !match;
                        return !isInline ? (
                          <SyntaxHighlighter
                            {...(rest as any)}
                            PreTag="div"
                            children={String(children).replace(/\n$/, '')}
                            language={match[1]}
                            style={oneLight}
                            className="rounded-md !my-4"
                          />
                        ) : (
                          <code {...rest} ref={ref} className={`${className || ''} bg-zinc-100 text-pink-600 px-1 py-0.5 rounded text-sm`}>
                            {children}
                          </code>
                        );
                      }
                    }}
                  >
                    {resumeMarkdown}
                  </Markdown>
                </div>
              </div>
            </div>
          </motion.div>
        ) : (
          <div className="flex-1 flex items-center justify-center p-6 text-center">
            <div className="max-w-md space-y-6">
              <div className="w-16 h-16 bg-zinc-100 rounded-2xl mx-auto flex items-center justify-center">
                <FileText className="w-8 h-8 text-zinc-400" />
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-semibold text-zinc-900">No Resume Generated Yet</h3>
                <p className="text-zinc-500">
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
