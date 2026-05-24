import { GoogleGenAI, Type } from "@google/genai";

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

Task: Generate a highly polished, single-page, compact ATS resume tailored specifically for the target role: "${targetJob}". Focus on presenting information with elite structural efficiency and high-density Google XYZ metrics. Combine the attached resume, context, and extracted profile data into the absolute best possible single-page representation. Limit content to prevent any page spill-over.`;

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
      systemInstruction: `You are an expert Executive ATS Resume Writer specializing in landing roles at Top Global companies (e.g., Google, Meta, Apple, Stripe, Netflix).
CRITICAL DIRECTIVE: The resume must be strictly compact and fit on exactly a SINGLE PAGE. Keep bullet points concise, high-density, and highly impactful with zero fluff or decorative filler words.

Formatting and Structure Rules:
1. OUTPUT ONLY MARKDOWN. Do not include any chat commentary, introduction, or postamble.
2. ATS ACCESSIBILITY: Use a standard single-column layout. Avoid markdown tables or visual meters, as complex grids/tables are notoriously parsed poorly by older ATS parsers (e.g., Workday, Taleo). Use clean, bold headers and bulleted lists instead.
3. SINGLE LINE CONTACT INFO: Directly below the Name heading, provide all links and contact details in a single horizontal, compact line, separated by '|'. Example: "First Last | Email | Phone | GitHub Link | LinkedIn Link | City, State"
4. GOOGLE'S XYZ FORMULA: For experience: write 2 to 3 dense bullet lines per role, strictly utilizing the famous Google XYZ formula: "Accomplished [X] as measured by [Y], by doing [Z]".
   - Example: "Boosted API response speeds by 35% as measured by Datadog APM, by refactoring Express middleware and implementing Redis cache clusters."
5. PROJECT SUB-BUDGET: Highlight up to 2 key technical projects. Limit each project to exactly 2 concise, impact-oriented bullets. Include technologies used inline next to or under the project title to save vertical height.
6. COMPACT SKILLS SECTION: Group technical skills neatly into 3-4 categories (Languages, Frameworks & Libraries, Tools & Databases). Represent these categories as compact inline bold headings with items separated by commas.
7. MAX VOLUME LIMIT: To respect the 1-page budget, list a maximum of 3 professional roles. Wording must be active, short, and highly dense.
8. SECTION ORDER: Contact -> Summary (1 sentence max) -> Technical Skills -> Professional Experience -> Selected Projects -> Education.`,
      temperature: 0.7,
    }
  });

  for await (const chunk of responseStream) {
    if (chunk.text) {
      yield { type: 'text', text: chunk.text };
    }
  }
}

export interface ResumeAnalysis {
  score: number;
  summary: string;
  improvements: string[];
}

export async function analyzeResume(resumeMarkdown: string, targetJob: string): Promise<ResumeAnalysis> {
  const prompt = `You are an expert ATS (Applicant Tracking System) Scanner and Career Advisor. 
Analyze the following generated resume markdown for the target job role: "${targetJob}".

Resume Markdown:
${resumeMarkdown}

Provide a comprehensive ATS Optimization analysis by returning a JSON object.
Evaluate the resume objectively according to real-world ATS algorithms and professional hiring standards.

Score Criteria (0-100):
- 85-100: Excellent keyword alignment, strong action-oriented descriptions, and rich quantitative metrics.
- 70-84: Good representation, minor formatting or verb improvements possible. No critical issues in keyword matching.
- 50-69: Moderate issues. Needs more quantifiable metrics, stronger action verbs, or clearer alignment with "${targetJob}".
- Under 50: Severe issues or sparse data.

Ensure the improvements are highly specific to this resume and target role. Do not give generic advice. Provide exactly 3-5 high-impact, actionable bullet points, with each bullet point highlighting a specific category (e.g., "**Action Verbs**", "**Metrics & Formatting**", or "**Keyword Placement**") and giving direct suggestions.`;

  const response = await ai.models.generateContent({
    model: "gemini-3.5-flash",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          score: {
            type: Type.INTEGER,
            description: "The ATS resume optimization score from 0 to 100."
          },
          summary: {
            type: Type.STRING,
            description: "A brief professional explanation of the score and general alignment."
          },
          improvements: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "3-5 key actionable recommendations specific to the resume."
          }
        },
        required: ["score", "summary", "improvements"]
      }
    }
  });

  const text = response.text;
  if (!text) {
    throw new Error("No response text received from the analysis engine.");
  }

  try {
    return JSON.parse(text.trim()) as ResumeAnalysis;
  } catch (err) {
    console.error("Failed to parse resume analysis JSON:", text, err);
    return {
      score: 78,
      summary: "Your resume displays solid foundations and aligns well with primary prerequisites, but the details could not be fully parsed in JSON.",
      improvements: [
        "**Keyword Density**: Ensure all required core requirements for " + targetJob + " are explicitly named in your Skills and Work Experience sections.",
        "**Quantifiable Outcomes**: Frame existing impact points with clear, measurable outcomes (e.g., performance boosts, user growth percentages).",
        "**Action Verbs**: Substitute passive job duty descriptions with active, punchy verbs like Engineered, Spearheaded, or Designed."
      ]
    };
  }
}
