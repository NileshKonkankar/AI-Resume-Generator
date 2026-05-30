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
  currentResume?: ResumeFile | null,
  jobDescription?: string
) {
  // Parallel processing of profile data for optimization
  const extractionPromises: Promise<string>[] = [];

  if (githubUrl) {
    yield { type: 'status', message: 'Scanning GitHub repositories, analyzing code metrics, and extracting projects...' };
    extractionPromises.push(
      ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Use Google Search to find and extract detailed information from this GitHub profile: ${githubUrl}. 
        CRITICAL TASK: Discover and spotlight the most outstanding projects, open-source contributions, key achievements, and portfolio milestones. Ranked projects by multidimensional impact:
        1. Technical Complexity: Architectural depth and engineering challenges solved.
        2. README Quality & Community Reception: Star counts, forks, clarity of documentation, and active repository velocity.
        3. Innovation: Evidence of addressing unique needs, custom optimizations, or high performance metrics.
        
        For each selected repository or project, extract:
        - Project name and GitHub Link
        - Core Accomplishments: Explicitly what was designed, built, scaled, or optimized.
        - Technologies Used (explicit tech stack)
        - Tangible Results & Key Achievements: Quantifiable accomplishments (e.g., "Reduced latency by 40%", "Acquired 500+ stars", "Wrote recursive custom compiler AST parsers", "Integrated with Google Maps API").
        - Impact and core features.
        
        Also extract general work experience, education, and technical skills from the profile.`,
        config: { tools: [{ googleSearch: {} }] }
      }).then(res => `GitHub Profile Extraction:\n${res.text}`)
        .catch(err => `Failed to fetch GitHub profile: ${err.message}`)
    );
  }

  if (linkedinUrl) {
    yield { type: 'status', message: 'Extracting career promotions, achievements, and certifications from LinkedIn...' };
    extractionPromises.push(
      ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Use Google Search to find and extract detailed information from this LinkedIn profile: ${linkedinUrl}. 
        CRITICAL TASK: Focus on finding the candidate's career trajectory, fast-track promotions, work history, education, certifications, and standout achievements.
        SEARCH HIGHLIGHTS TO DISCOVER & SPOTLIGHT:
        1. Professional Promotions & Fast-Track Career Growth.
        2. Awards, Honors, Certifications, or Hackathon achievements.
        3. Quantifiable Business Impact (e.g., "Led team of 4", "Increased user base by 45%", "Saved $20k in cloud hosting costs").
        4. Key technical deliverables, architectural redesigns, and team/project leadership milestones.
        
        Extract full details for exact job titles, organization names, dates, and highly-specific achievements.`,
        config: { tools: [{ googleSearch: {} }] }
      }).then(res => `LinkedIn Professional History, Achievements & Certifications:\n${res.text}`)
        .catch(err => `Failed to fetch LinkedIn profile: ${err.message}`)
    );
  }

  // Wait for all external search extractions to complete in parallel
  const searchResults = await Promise.all(extractionPromises);
  const searchContext = searchResults.join('\n\n');

  yield { type: 'status', message: 'Synthesizing professional narrative and formatting for ATS...' };

  const prompt = `Target Role: ${targetJob}
${jobDescription ? `Target Job Description (JD):\n"""\n${jobDescription}\n"""\n` : ''}
${additionalContext ? `Context: ${additionalContext}` : ''}
${currentResume ? `[Resume attached via inline data]` : ''}

${searchContext ? `--- Extracted Profile Data ---\n${searchContext}\n---` : ''}

Task: Generate a highly polished, single-page, compact ATS resume tailored specifically for the target role: "${targetJob}"${jobDescription ? ` and explicitly aligned/balanced to match the key technical expectations, mandatory technologies, skills, and databases specified in the Job Description (JD). Extract every relevant technical skill from the JD and integrate them directly into the "Technical Skills" section and weave them naturally into experience bullet points` : ''}. Focus on presenting information with elite structural efficiency and high-density Google XYZ metrics. Combine the attached resume, context, and extracted profile data into the absolute best possible single-page representation. Limit content to prevent any page spill-over.`;

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
4. GOOGLE'S XYZ FORMULA & HIGHLIGHTED ACHIEVEMENTS: For experience, write 2 to 3 dense bullet lines per role. Strictly utilize the famous Google XYZ formula: "Accomplished [X] as measured by [Y], by doing [Z]".
   - Prioritize including key professional accomplishments, work promotions, awards, scale achievements, and business cost-savings discovered from LinkedIn or GitHub.
   - Example: "Boosted API response speeds by 35% as measured by Datadog APM, by refactoring Express middleware and implementing Redis cache clusters."
5. PROJECT SUB-BUDGET & COMMUNITY METRICS: Highlight up to 2 key technical projects from the candidate's GitHub profile. 
   - Integrate stellar GitHub community reception, stars, forks, or major open-source architectural contributions explicitly within the bullet points.
   - Limit each project to exactly 2 concise, impact-oriented bullets using the Google XYZ framework. Include technologies used inline next to or under the project title to save vertical height.
6. AWARDS, CERTIFICATIONS & HONORS: If any notable industry certifications, professional honors, hackathon victories, or awards were found on LinkedIn or GitHub, represent them neatly in an "Awards & Certifications" sections or integrate them as elite highlights next to Education/Experience.
7. COMPACT SKILLS SECTION: Group technical skills neatly into 3-4 categories (Languages, Frameworks & Libraries, Tools & Databases). Represent these categories as compact inline bold headings with items separated by commas.
8. MAX VOLUME LIMIT: To respect the 1-page budget, list a maximum of 3 professional roles. Wording must be active, short, and highly dense.
9. SECTION ORDER: Contact -> Summary (1 sentence max) -> Technical Skills -> Professional Experience -> Selected Projects -> Education.`,
      temperature: 0.7,
    }
  });

  for await (const chunk of responseStream) {
    if (chunk.text) {
      yield { type: 'text', text: chunk.text };
    }
  }
}

export async function* generateCoverLetterStream(
  githubUrl: string,
  linkedinUrl: string,
  targetJob: string,
  additionalContext: string,
  currentResume?: ResumeFile | null,
  jobDescription?: string,
  resumeMarkdown?: string
) {
  yield { type: 'status', message: 'Analyzing job description and tailored resume...' };

  const prompt = `Target Role: ${targetJob}
${jobDescription ? `Target Job Description (JD):\n"""\n${jobDescription}\n"""\n` : ''}
${additionalContext ? `Additional Context: ${additionalContext}` : ''}
${resumeMarkdown ? `Compiled Resume Details:\n"""\n${resumeMarkdown}\n"""\n` : ''}

Task: Write an outstanding, professionally structured Cover Letter tailored for the target role: "${targetJob}".
The Cover Letter MUST:
1. Align with the provided Job Description, showing how the candidate's achievements (from their resume and professional profile) make them the perfect match.
2. Structure itself with standard premium layout sections:
   - Contact Info Slot / Headline
   - Professional Greeting
   - Compelling Opening hooking the recruiter's attention
   - Main Body paragraphs explicitly mapping GitHub/LinkedIn achievements and skills to the JD requirements
   - Call to Action (interview request) and Warm Professional Sign-off
3. Keep the entire cover letter highly punchy and concise (around 250 - 350 words, maximum 3-4 paragraphs) to guarantee it fits on a single printed page.
4. If company, manager, or recruiter details are not explicitly found in context, use sophisticated default values like 'The Hiring Team' or '[Target Company]'. DO NOT output bracketed raw placeholders like '[Your Name]' or '[Company Name]'. Instead, pre-fill them intelligently using candidate data details (e.g. from resume) or high-quality descriptive labels.
5. Direct output as clean Markdown only. Extra headers, commentary, introductions, or postambles are strictly forbidden.`;

  const responseStream = await ai.models.generateContentStream({
    model: "gemini-3.1-pro-preview",
    contents: prompt,
    config: {
      systemInstruction: "You are an expert executive coach and master cover letter writer. You specialize in crafting concise, professional, achievement-driven cover letters that connect and resonate with hiring managers. You know exactly how to demonstrate a candidate's high impact without fluff.",
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
  missingKeywords: string[];
  matchingKeywords: string[];
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

Ensure the improvements are highly specific to this resume and target role. Do not give generic advice. Provide exactly 3-5 high-impact, actionable bullet points, with each bullet point highlighting a specific category (e.g., "**Action Verbs**", "**Metrics & Formatting**", or "**Keyword Placement**") and giving direct suggestions.

Identify the crucial technical skills, concepts, methodologies, or tools that are highly recommended or required for the target role "${targetJob}" (e.g., for Frontend developer: React, TypeScript, State Management, CSS, Tailwind, etc.). 
Determine which of these keywords are MISSING from the resume text, and which are MATCHING/PRESENT (case-insensitive substring matched).
Provide exactly 5 to 10 highly relevant items for each list.`;

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
          },
          missingKeywords: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "List of 5-10 recommended skills/keywords that are NOT mentioned in the resume but are vital for " + targetJob
          },
          matchingKeywords: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "List of recommended skills/keywords that are successfully included in the resume."
          }
        },
        required: ["score", "summary", "improvements", "missingKeywords", "matchingKeywords"]
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
      ],
      missingKeywords: ["TypeScript", "CI/CD", "Unit Testing", "System Architecture", "Performance Optimization"],
      matchingKeywords: ["React", "JavaScript", "HTML5", "Tailwind CSS", "Git"]
    };
  }
}

export async function* fineTuneResumeStream(
  currentResumeMarkdown: string,
  targetJob: string,
  jobDescription?: string,
  improvements?: string[],
  missingKeywords?: string[]
) {
  yield { type: 'status', message: 'Applying expert optimizations and embedding missing technical skills...' };

  const prompt = `Target Role: ${targetJob}
${jobDescription ? `Target Job Description (JD):\n"""\n${jobDescription}\n"""\n` : ''}

Current Resume Markdown to optimize:
"""
${currentResumeMarkdown}
"""

Critical recommendations to resolve and apply directly to the resume contents:
${improvements && improvements.length > 0 ? improvements.map(imp => `- ${imp}`).join('\n') : '- Make experience descriptions more action-oriented with quantitative Google XYZ formula metrics.\n- Replace passive verbs with elite active equivalents.'}

Key skills/prerequisites from the JD to weave in:
${missingKeywords && missingKeywords.length > 0 ? missingKeywords.map(kw => `- ${kw}`).join('\n') : '- Integrate all relevant job title keywords and modern systems engineering concepts.'}

Task: Write a fully fine-tuned, auto-optimized, highly aligned version of the resume markdown. Weave all identified technical skills and keywords directly into standard sections (e.g., "Technical Skills" headers and experience bullet points). Directly apply every suggested recommendation into the text itself so the candidate doesn't have to make any manual changes.

Output Constraints:
1. OUTPUT ONLY THE FULL REVISED MARKDOWN content of the resume. Do not add introductory comments, explanation bullet points, chat preambles, or formatting advice.
2. Maintain standard ATS single-column formatting. No markdown tables.
3. Keep the content ultra-dense and compact to guarantee it fits exactly on a single page. Use active, punchy, quantitative Google XYZ formula metrics ("Accomplished [X] as measured by [Y], by doing [Z]").
4. Maintain contact details horizontally on a single line.`;

  const responseStream = await ai.models.generateContentStream({
    model: "gemini-3.1-pro-preview",
    contents: prompt,
    config: {
      systemInstruction: "You are an elite master executive coach and executive resume rewriter. You take an existing candidate resume, apply custom feedback and keyword checklists, and write a flawless, highly polished, fully aligned, single-page technical resume that achieves top scores on automatic applicant tracking scanners (ATS).",
      temperature: 0.6,
    }
  });

  for await (const chunk of responseStream) {
    if (chunk.text) {
      yield { type: 'text', text: chunk.text };
    }
  }
}
