import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface ResumeFile {
  data: string;
  mimeType: string;
}

export async function* generateResumeStream(
  githubUrl: string, 
  linkedinUrl: string, 
  targetJob: string, 
  additionalContext: string,
  currentResume?: ResumeFile | null
) {
  // Parallel processing of profile data for optimization
  const extractionPromises: Promise<string>[] = [];

  if (githubUrl) {
    yield { type: 'status', message: 'Scanning GitHub repositories and evaluating project impact...' };
    extractionPromises.push(
      ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Use Google Search to find and extract detailed information from this GitHub profile: ${githubUrl}. 
        CRITICAL TASK: Identify and select the 2-3 most significant projects. 
        PRIORITIZATION: Rank projects by multidimensional impact:
        1. Technical Complexity: Architectural depth and engineering challenges solved.
        2. README Quality: Clarity of documentation and articulated problem-solving.
        3. Popularity & Activity: Star counts and recent commit velocity.
        4. Innovation: Evidence of addressing unique needs or optimizing processes.
        For each selected project, provide:
        - Project name
        - Project Purpose: A concise summary of why the project exists.
        - Your Role: Specifically, what were the candidate's core contributions (Lead, Contributor, Creator).
        - Technologies Used (explicit tech stack)
        - Key Achievements: Quantifiable metrics (e.g., "Reduced latency by 40%", "Acquired 500+ stars", "Integrated with X API").
        - Impact and key features (detailed description)
        - GitHub link (if available)
        
        Also extract general work experience, education, and technical skills from the profile.`,
        config: { tools: [{ googleSearch: {} }] }
      }).then(res => `GitHub Profile Extraction:\n${res.text}`)
        .catch(err => `Failed to fetch GitHub profile: ${err.message}`)
    );
  }

  if (linkedinUrl) {
    yield { type: 'status', message: 'Extracting professional history and skills from LinkedIn...' };
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

  yield { type: 'status', message: 'Synthesizing professional narrative and formatting for ATS...' };

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
      systemInstruction: "You are an expert ATS Resume Writer. Rules:\n1. OUTPUT ONLY MARKDOWN. NO PREAMBLE.\n2. MAXIMIZE IMPACT: For Work Experience and Projects, use strong action verbs (e.g., 'Spearheaded', 'Engineered', 'Optimized', 'Architected') and lead with quantifiable achievements (e.g., 'Boosted efficiency by 30%', 'Scale to 1M+ users', 'Reduced latency by 150ms').\n3. BULLET POINTS: Write 4-6 rich bullet points per role focusing on technical depth, specific contributions, and measurable outcomes.\n4. PROJECTS SECTION: Highlight the 2-3 most significant GitHub projects. Structure:\n   - Project Title & GitHub Link\n   - Purpose & Role: One sentence on context and your specific involvement.\n   - Technologies Used: List tech stack.\n   - Key Results: 3-4 bullet points using the 'Action Verb + Task + Result' formula.\n5. Structure: Contact, Summary, Skills, Work Experience, Projects, Education.",
      temperature: 0.7,
    }
  });

  for await (const chunk of responseStream) {
    if (chunk.text) {
      yield { type: 'text', text: chunk.text };
    }
  }
}
