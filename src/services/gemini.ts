import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface ResumeFile {
  data: string;
  mimeType: string;
}

export async function generateResumeStream(
  githubUrl: string, 
  linkedinUrl: string, 
  targetJob: string, 
  additionalContext: string,
  currentResume?: ResumeFile | null
) {
  // Parallel processing of profile data for optimization
  const extractionPromises: Promise<string>[] = [];

  if (githubUrl) {
    extractionPromises.push(
      ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Use Google Search to find and extract detailed information from this GitHub profile: ${githubUrl}. 
        CRITICAL TASK: Identify and select the 2-3 best/most significant projects based on stars, complexity, and impact. 
        For each selected project, provide:
        - Project name
        - Technical stack
        - Impact and key features (detailed description)
        - GitHub link (if available)
        
        Also extract general work experience, education, and technical skills from the profile.`,
        config: { tools: [{ googleSearch: {} }] }
      }).then(res => `GitHub Profile Extraction:\n${res.text}`)
        .catch(err => `Failed to fetch GitHub profile: ${err.message}`)
    );
  }

  if (linkedinUrl) {
    extractionPromises.push(
      ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Use Google Search to find and extract detailed information from this LinkedIn profile: ${linkedinUrl}. Focus on work experience, education, skills, and exact job titles/dates. Return a comprehensive summary.`,
        config: { tools: [{ googleSearch: {} }] }
      }).then(res => `LinkedIn Profile Extraction:\n${res.text}`)
        .catch(err => `Failed to fetch LinkedIn profile: ${err.message}`)
    );
  }

  // Wait for all external search extractions to complete in parallel
  const searchResults = await Promise.all(extractionPromises);
  const searchContext = searchResults.join('\n\n');

  const prompt = `Target Role: ${targetJob}
${additionalContext ? `Context: ${additionalContext}` : ''}
${currentResume ? `[Resume attached via inline data]` : ''}

${searchContext ? `--- Extracted Profile Data ---\n${searchContext}\n---` : ''}

Task: Generate a maximum-detail ATS resume, expanding on all the available data provided. Combine the attached resume data, context, and extracted profile data to build the best possible representation of the candidate.`;

  const contents: any[] = [];
  if (currentResume) {
    contents.push({
      inlineData: {
        data: currentResume.data,
        mimeType: currentResume.mimeType
      }
    });
  }
  contents.push(prompt);

  const responseStream = await ai.models.generateContentStream({
    model: "gemini-3.1-pro-preview", // Use the more capable model for the final assembly since we no longer need tools
    contents: contents,
    config: {
      systemInstruction: "You are an expert ATS Resume Writer. Rules:\n1. OUTPUT ONLY MARKDOWN. NO PREAMBLE.\n2. MAXIMIZE DETAIL: Write 4-6 rich bullet points per role/project focusing on impact, metrics, and technical depth.\n3. PROJECTS SECTION: Specifically highlight the 2-3 best projects extracted from GitHub. For each project, include a mandatory 'Technologies Used' subsection explicitly listing the tech stack, and a 'Key Responsibilities' subsection with 2-3 bullet points detailing specific contributions and achievements. Provide technical depth and outcomes for each.\n4. Structure: Contact, Summary, Skills, Work Experience, Projects, Education.",
      temperature: 0.7,
    }
  });

  return responseStream;
}
