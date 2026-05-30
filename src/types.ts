import { ResumeAnalysis } from './services/gemini';

export interface ResumeHistoryItem {
  id: string;
  timestamp: number;
  targetJob: string;
  githubUrl: string;
  linkedinUrl: string;
  additionalContext: string;
  resumeMarkdown: string;
  atsScore: ResumeAnalysis | null;
  resumeFileName?: string;
  resumeFileData?: string;
  resumeFileMimeType?: string;
  jobDescription?: string;
  coverLetterMarkdown?: string;
  isFineTuned?: boolean;
}
