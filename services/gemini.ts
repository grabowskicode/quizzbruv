import { GoogleGenAI, Type } from "@google/genai";
import { QuizQuestion } from "../types";

// Helper function to shuffle options to avoid position bias
const shuffleOptions = <T>(array: T[]): T[] => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

export const generateQuizBatch = async (
  content: string, 
  existingTitles: string[], 
  apiKey: string,
  isImage: boolean = false
): Promise<QuizQuestion[]> => {
  // Use user provided key, or fallback to env var
  const keyToUse = apiKey || process.env.API_KEY || '';
  
  if (!keyToUse) {
    throw new Error("Hiányzó API kulcs. Kérjük, adja meg a Gemini API kulcsát a fenti mezőben.");
  }

  const ai = new GoogleGenAI({ apiKey: keyToUse });
  
  // Véletlenszerű érték a kiválasztási folyamat befolyásolásához
  const selectionSeed = Math.floor(Math.random() * 1000000);

  const avoidanceContext = existingTitles.length > 0 
    ? `FONTOS: Már kinyertem ${existingTitles.length} kérdést. NE ISMÉTELD MEG EZEKET: [${existingTitles.slice(-30).join(", ")}]. Keress teljesen ÚJ kérdéseket.`
    : "Nyerj ki 15 kérdést a tartalomból.";

  const prompt = isImage 
    ? `${avoidanceContext} Válassz ki véletlenszerűen és nyerj ki 15 kérdést erről a képről. Ne kövesd a vizuális sorrendet. Térj vissza 15 egyedi kérdéssel JSON formátumban. Add meg a kérdés szövegét, pontosan 4 opciót, az ÖSSZES helyes választ (több is lehet), egy magyarázatot és az eredeti sorszámot. A válaszok nyelve MAGYAR legyen.`
    : `A megadott szöveg alapján nyerj ki 15 EGYEDI kérdést a következő szigorú szabályok szerint:
       1. ${avoidanceContext}
       2. KIVÁLASZTÁS: Válassz kérdéseket véletlenszerűen a teljes dokumentumból (például ugrálj az eleje, közepe és vége között). Ne sorrendben haladj.
       3. VÉLETLENSZERŰSÉG: Használd ezt a tippet a variáláshoz: ${selectionSeed}.
       4. FORMÁTUM: Minden kérdésnél nyerd ki a következőket:
          - question: a kérdés szövege (MAGYARUL)
          - options: pontosan 4 válaszlehetőség (MAGYARUL)
          - correct_answers: a helyes válasz(ok) listája (támogasd a több helyes választ is)
          - explanation: rövid magyarázat (MAGYARUL)
          - original_index: az eredeti jelölés vagy sorszám a forrásszövegből (pl. '1' vagy 'Q15')
       5. MENNYISÉG: Mindig próbálj meg pontosan 15 kérdést visszaadni, ha az anyag lehetővé teszi.
       6. NYELV: Minden generált szöveg MAGYAR nyelven legyen.
       
       Forrásszöveg: \n\n${content}`;

  const response = await ai.models.generateContent({
    model: "gemini-3-pro-preview",
    contents: isImage 
      ? { parts: [{ inlineData: { data: content, mimeType: 'image/jpeg' } }, { text: prompt }] }
      : prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            question: { type: Type.STRING },
            options: { 
              type: Type.ARRAY, 
              items: { type: Type.STRING },
              description: "Pontosan 4 opciónak kell lennie"
            },
            correct_answers: { 
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "A helyes válaszokat tartalmazó tömb"
            },
            explanation: { type: Type.STRING },
            original_index: { 
              type: Type.STRING,
              description: "Hivatkozás az eredeti kérdés azonosítójára a dokumentumban"
            }
          },
          required: ["question", "options", "correct_answers", "explanation", "original_index"]
        }
      }
    }
  });

  if (!response.text) {
    throw new Error("Az API nem küldött választ.");
  }

  try {
    const data = JSON.parse(response.text) as QuizQuestion[];
    
    // We shuffle the options here on the client side to ensure the correct answer
    // isn't always in the same position (e.g. index 1) due to LLM bias.
    return data.map(q => ({
      ...q,
      options: shuffleOptions(q.options)
    }));
  } catch (e) {
    console.error("JSON értelmezési hiba. Kapott válasz:", response.text);
    throw new Error("Nem sikerült feldolgozni a kvíz adatokat. Kérjük, próbálja újra.");
  }
};