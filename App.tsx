import React, { useState, useMemo, useRef } from 'react';
import { Upload, FileText, CheckCircle2, AlertCircle, RefreshCw, ChevronRight, BookOpen, ImageIcon, Trophy, PlusCircle, Zap, CheckSquare } from 'lucide-react';
import { QuizState, QuizQuestion } from './types';
import { generateQuizBatch } from './services/gemini';
import { extractTextFromPdf, fileToBase64 } from './utils/pdfLoader';

const BATCH_SIZE = 15;
const MAX_QUESTIONS = 65;

const shuffleArray = <T,>(array: T[]): T[] => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

const App: React.FC = () => {
  const [apiKey, setApiKey] = useState("");
  const [state, setState] = useState<QuizState>({
    questions: [],
    userAnswers: {},
    checkedQuestions: new Set(),
    isLoading: false,
    error: null
  });

  const [activeFile, setActiveFile] = useState<{ name: string, type: string, content: string } | null>(null);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [hasReachedEnd, setHasReachedEnd] = useState(false);
  
  // Referencia azon kérdésindexek követésére, amelyek már kiváltottak egy automatikus betöltést
  const triggeredIndicesRef = useRef<Set<number>>(new Set());

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    triggeredIndicesRef.current = new Set();
    setHasReachedEnd(false);
    setState(prev => ({ 
      ...prev, 
      isLoading: true, 
      error: null, 
      checkedQuestions: new Set(), 
      userAnswers: {}, 
      questions: [] 
    }));

    try {
      let content = "";
      let isImage = false;

      if (file.type === 'application/pdf') {
        content = await extractTextFromPdf(file);
      } else if (file.type.startsWith('image/')) {
        content = await fileToBase64(file);
        isImage = true;
      } else {
        throw new Error("Kérjük, töltsön fel egy PDF fájlt vagy képet.");
      }

      setActiveFile({ name: file.name, type: file.type, content });
      
      const initialBatch = await generateQuizBatch(content, [], apiKey, isImage);
      // Első 15 kérdés összekeverése a véletlenszerű megjelenítéshez
      const shuffledBatch = shuffleArray(initialBatch);
      setState(prev => ({ ...prev, questions: shuffledBatch, isLoading: false }));
    } catch (err: any) {
      setState(prev => ({ ...prev, isLoading: false, error: err.message || "A kinyerés sikertelen." }));
    }
  };

  const loadMoreQuestions = async (isAuto = false) => {
    if (!activeFile || isFetchingMore || hasReachedEnd) return;
    
    // Ellenőrizzük, hogy elértük-e a maximális limitet
    if (state.questions.length >= MAX_QUESTIONS) {
      setHasReachedEnd(true);
      return;
    }
    
    setIsFetchingMore(true);
    try {
      const existingTitles = state.questions.map(q => q.question);
      const isImage = activeFile.type.startsWith('image/');
      const nextBatch = await generateQuizBatch(activeFile.content, existingTitles, apiKey, isImage);
      
      // Szigorú kliens oldali szűrés a duplikációk elkerülésére
      const uniqueNextBatch = nextBatch.filter(newQ => 
        !existingTitles.some(existingQ => existingQ === newQ.question)
      );

      if (uniqueNextBatch.length > 0) {
        // Csak annyit adunk hozzá, amennyi még belefér a MAX_QUESTIONS limitbe
        const remainingSlots = MAX_QUESTIONS - state.questions.length;
        const questionsToAdd = uniqueNextBatch.slice(0, remainingSlots);
        const shuffledNextBatch = shuffleArray(questionsToAdd);
        
        setState(prev => ({
          ...prev,
          questions: [...prev.questions, ...shuffledNextBatch]
        }));
        
        // Ha a hozzáadás után elértük a limitet, jelezzük a végét
        if (state.questions.length + questionsToAdd.length >= MAX_QUESTIONS) {
          setHasReachedEnd(true);
        }
      } else {
        if (!isAuto && nextBatch.length > 0) {
           // Az API visszaküldött kérdéseket, de mind duplikált volt
           alert("Nem találtunk több új, egyedi kérdést a dokumentumban.");
        }
        // Ha üres vagy csak duplikáció jött vissza, feltételezzük, hogy vége
        setHasReachedEnd(true);
      }
    } catch (err: any) {
      console.error("Automatikus betöltési hiba:", err);
      if (!isAuto) alert("Nem sikerült többet betölteni: " + err.message);
    } finally {
      setIsFetchingMore(false);
    }
  };

  const toggleOption = (questionIndex: number, option: string) => {
    if (state.checkedQuestions.has(questionIndex)) return;
    
    setState(prev => {
      const currentAnswers = prev.userAnswers[questionIndex] || [];
      const newAnswers = currentAnswers.includes(option)
        ? currentAnswers.filter(a => a !== option)
        : [...currentAnswers, option];
      
      return {
        ...prev,
        userAnswers: { ...prev.userAnswers, [questionIndex]: newAnswers }
      };
    });
  };

  const checkIndividualAnswer = (questionIndex: number) => {
    setState(prev => {
      const newChecked = new Set(prev.checkedQuestions);
      newChecked.add(questionIndex);
      return { ...prev, checkedQuestions: newChecked };
    });

    // Adagon belüli pozíció meghatározása (0-tól 14-ig)
    const relativeIndex = questionIndex % BATCH_SIZE;
    
    // Betöltés indítása a 3. (idx 2) és 13. (idx 12) kérdés megválaszolásakor
    const isTriggerPoint = (relativeIndex === 2 || relativeIndex === 12);

    if (isTriggerPoint && !triggeredIndicesRef.current.has(questionIndex)) {
      triggeredIndicesRef.current.add(questionIndex);
      loadMoreQuestions(true);
    }
  };

  const resetQuiz = () => {
    setState({
      questions: [],
      userAnswers: {},
      checkedQuestions: new Set(),
      isLoading: false,
      error: null
    });
    setActiveFile(null);
    setHasReachedEnd(false);
    triggeredIndicesRef.current = new Set();
  };

  const progress = useMemo(() => {
    if (state.questions.length === 0) return 0;
    return (state.checkedQuestions.size / state.questions.length) * 100;
  }, [state.checkedQuestions, state.questions]);

  const score = useMemo(() => {
    let count = 0;
    state.checkedQuestions.forEach(idx => {
      const q = state.questions[idx];
      const user = state.userAnswers[idx] || [];
      if (q && user.length === q.correct_answers.length && user.every(a => q.correct_answers.includes(a))) {
        count++;
      }
    });
    return count;
  }, [state.checkedQuestions, state.userAnswers, state.questions]);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center py-12 px-4">
      <header className="max-w-3xl w-full mb-12 text-center">
        <div className="inline-flex items-center justify-center p-3 bg-slate-900 rounded-2xl mb-4 text-white shadow-lg shadow-slate-300">
          <BookOpen size={32} />
        </div>
        <h1 className="text-4xl font-bold text-slate-900 mb-2">Quizz Bruv</h1>
        <p className="text-slate-600 font-medium mb-6">Kérdések folyamatos kinyerése a dokumentumból (Max {MAX_QUESTIONS} kérdés).</p>
        
        <div className="max-w-md mx-auto relative group">
          <input 
            type="password" 
            placeholder="Illeszd be a Gemini API kulcsodat..." 
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 focus:border-slate-800 focus:ring-4 focus:ring-slate-100 outline-none transition-all text-sm font-medium bg-white placeholder:text-slate-400 text-slate-900"
          />
          <p className="text-[11px] text-slate-500 mt-2 font-medium">
            Ingyenes kulcs igénylése itt: <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-slate-900 underline decoration-slate-400 hover:text-slate-700 hover:decoration-slate-700 transition-all">Google AI Studio</a>. (Ha van saját kulcsod, azt használjuk.)
          </p>
        </div>
      </header>

      {state.questions.length > 0 && (
        <div className="max-w-3xl w-full sticky top-4 z-50 mb-8 px-4">
          <div className="bg-white/95 backdrop-blur-xl rounded-2xl p-4 shadow-xl border border-slate-200 flex flex-col gap-2 relative overflow-hidden">
            {isFetchingMore && (
              <div className="absolute top-0 left-0 w-full h-1 bg-slate-900/10">
                <div className="h-full bg-slate-900 animate-[loading_1.5s_infinite_linear]" style={{width: '30%'}}></div>
              </div>
            )}
            <style>{`
              @keyframes loading {
                0% { transform: translateX(-100%); }
                100% { transform: translateX(400%); }
              }
            `}</style>
            <div className="flex justify-between items-center px-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-black text-slate-400 uppercase tracking-[0.2em]">Folyamat állapota</span>
                {isFetchingMore && (
                  <span className="flex items-center gap-1 text-[10px] font-bold text-slate-700 animate-pulse bg-slate-100 px-2 py-0.5 rounded-full uppercase">
                    <Zap size={10} fill="currentColor" /> Továbbiak betöltése...
                  </span>
                )}
                {hasReachedEnd && (
                   <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full uppercase">
                     Összes kérdés kinyerve
                   </span>
                )}
              </div>
              <span className="text-sm font-bold text-slate-800">
                Helyes: {score} | {state.checkedQuestions.size} / {state.questions.length} kérdés
              </span>
            </div>
            <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
              <div 
                className="h-full bg-slate-800 transition-all duration-700 ease-in-out" 
                style={{ width: `${progress}%` }} 
              />
            </div>
          </div>
        </div>
      )}

      <main className="max-w-3xl w-full pb-32">
        {state.error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3 text-red-700 animate-in fade-in slide-in-from-top-4">
            <AlertCircle className="shrink-0" />
            <p className="font-medium">{state.error}</p>
          </div>
        )}

        {!state.isLoading && state.questions.length === 0 && (
          <div className="bg-white border-2 border-dashed border-slate-200 rounded-3xl p-12 flex flex-col items-center text-center transition-all hover:border-slate-400 hover:bg-slate-50/50 group">
            <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mb-6 text-slate-800 group-hover:scale-110 transition-transform">
              <Upload size={36} />
            </div>
            <h2 className="text-2xl font-semibold mb-2">Forrásanyag feltöltése</h2>
            <p className="text-slate-500 mb-8 max-w-sm">Először 15 véletlenszerű kérdést nyerünk ki. A további kérdések automatikusan töltődnek be, amíg van elérhető tartalom (max {MAX_QUESTIONS}).</p>
            <label className="bg-slate-900 hover:bg-slate-800 text-white font-semibold py-4 px-10 rounded-2xl cursor-pointer transition-all shadow-xl shadow-slate-200 flex items-center gap-2 active:scale-95">
              <FileText size={20} />
              Véletlenszerű kinyerés indítása
              <input type="file" className="hidden" accept=".pdf,image/*" onChange={handleFileUpload} />
            </label>
          </div>
        )}

        {state.isLoading && (
          <div className="bg-white rounded-3xl shadow-sm p-12 flex flex-col items-center text-center">
            <div className="relative w-20 h-20 mb-6">
              <div className="absolute inset-0 border-4 border-slate-100 rounded-full"></div>
              <div className="absolute inset-0 border-4 border-slate-900 border-t-transparent rounded-full animate-spin"></div>
              <div className="absolute inset-0 flex items-center justify-center text-slate-900">
                <RefreshCw size={32} />
              </div>
            </div>
            <h2 className="text-2xl font-semibold mb-2">Kérdések bányászása...</h2>
            <p className="text-slate-500">A dokumentum feldolgozása folyamatban.</p>
          </div>
        )}

        {state.questions.length > 0 && !state.isLoading && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-500">
            <div className="flex items-center justify-between mb-4 px-2">
              <div className="flex items-center gap-2 text-slate-400 text-xs font-bold uppercase tracking-widest truncate max-w-[300px]">
                {activeFile?.type === 'application/pdf' ? <FileText size={14} /> : <ImageIcon size={14} />}
                {activeFile?.name}
              </div>
              <button 
                onClick={resetQuiz}
                className="text-slate-400 hover:text-red-500 text-xs font-bold uppercase tracking-widest flex items-center gap-1 transition-colors"
              >
                Kvíz törlése
              </button>
            </div>

            {state.questions.map((q, idx) => (
              <QuestionCard 
                key={idx}
                index={idx}
                question={q}
                selectedAnswers={state.userAnswers[idx] || []}
                onToggle={(ans) => toggleOption(idx, ans)}
                onCheck={() => checkIndividualAnswer(idx)}
                isChecked={state.checkedQuestions.has(idx)}
              />
            ))}

            <div className="pt-8 border-t border-slate-200">
              {isFetchingMore ? (
                <div className="flex flex-col items-center gap-3 text-slate-800 animate-pulse">
                  <RefreshCw size={32} className="animate-spin" />
                  <span className="font-bold text-sm uppercase tracking-widest">Következő adag bányászása...</span>
                </div>
              ) : !hasReachedEnd ? (
                <button
                  onClick={() => loadMoreQuestions(false)}
                  className="w-full py-6 rounded-3xl border-4 border-dashed border-slate-300 hover:border-slate-400 hover:bg-slate-100/50 text-slate-900 font-bold transition-all flex flex-col items-center justify-center gap-2 group"
                >
                  <PlusCircle size={32} className="group-hover:rotate-90 transition-transform duration-300" />
                  <span>További kérdések keresése</span>
                  <span className="text-xs font-medium text-slate-400">
                    Még {MAX_QUESTIONS - state.questions.length} kérdés nyerhető ki
                  </span>
                </button>
              ) : (
                <div className="text-center py-6 text-slate-400 font-bold uppercase tracking-[0.2em] text-[10px]">
                  Nem található több kérdés vagy elértük a {MAX_QUESTIONS}-es limitet
                </div>
              )}
            </div>

            {state.checkedQuestions.size === state.questions.length && !isFetchingMore && hasReachedEnd && (
              <div className="bg-slate-900 rounded-3xl p-10 text-center shadow-2xl shadow-slate-400 text-white mt-12 animate-in zoom-in duration-500">
                <div className="inline-flex p-4 bg-white/20 rounded-full mb-4">
                   <Trophy size={48} />
                </div>
                <h3 className="text-3xl font-bold mb-2">Kvíz befejezve!</h3>
                <p className="text-slate-400 mb-6 text-lg">Végeredmény: {score} a(z) {state.questions.length}-ból</p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <button
                    onClick={resetQuiz}
                    className="bg-white text-slate-900 font-bold py-4 px-10 rounded-2xl transition-all shadow-lg hover:scale-105 active:scale-95"
                  >
                    Új fájl indítása
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
      
      <footer className="mt-12 text-slate-400 text-xs font-bold uppercase tracking-widest opacity-60">
        Folyamatos kinyerés • Max {MAX_QUESTIONS} kérdés • Duplikáció szűrés • Gemini 3 Pro
      </footer>
    </div>
  );
};

interface QuestionCardProps {
  index: number;
  question: QuizQuestion;
  selectedAnswers: string[];
  onToggle: (option: string) => void;
  onCheck: () => void;
  isChecked: boolean;
}

const QuestionCard: React.FC<QuestionCardProps> = ({ index, question, selectedAnswers, onToggle, onCheck, isChecked }) => {
  const isCorrect = useMemo(() => {
    return selectedAnswers.length === question.correct_answers.length && 
           selectedAnswers.every(ans => question.correct_answers.includes(ans));
  }, [selectedAnswers, question.correct_answers]);
  
  return (
    <div className={`bg-white rounded-[2.5rem] shadow-sm p-8 transition-all duration-500 border-2 ${
      isChecked 
        ? (isCorrect ? 'border-green-200 ring-8 ring-green-50/50 shadow-green-100/50' : 'border-red-200 ring-8 ring-red-50/50 shadow-red-100/50') 
        : (selectedAnswers.length > 0 ? 'border-slate-300 shadow-md' : 'border-slate-100')
    }`}>
      <div className="flex items-start gap-4 mb-8">
        <span className={`flex items-center justify-center w-10 h-10 rounded-2xl font-black text-sm shrink-0 transition-all ${
          isChecked 
            ? (isCorrect ? 'bg-green-500 text-white' : 'bg-red-500 text-white')
            : 'bg-slate-900 text-white'
        }`}>
          {index + 1}
        </span>
        <div className="flex-1 pt-1">
          <h3 className="text-xl font-bold text-slate-900 leading-snug">
            {question.question}
          </h3>
          <p className="text-[10px] font-black text-slate-500 mt-2 uppercase tracking-[0.15em]">
            {question.correct_answers.length > 1 ? 'Több helyes válasz lehetséges' : 'Válasszon egy választ'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3">
        {question.options.map((option, i) => {
          const isUserChoice = selectedAnswers.includes(option);
          const isCorrectOption = question.correct_answers.includes(option);
          
          let optionStyles = "flex items-center gap-4 p-5 rounded-3xl border-2 transition-all cursor-pointer relative group ";
          
          if (!isChecked) {
            optionStyles += isUserChoice 
              ? "bg-slate-800 border-slate-800 text-white shadow-lg font-bold" 
              : "bg-slate-50 border-slate-50 hover:border-slate-300 text-slate-700 hover:bg-white";
          } else {
            if (isCorrectOption) {
              optionStyles += "bg-green-50 border-green-500 text-green-800 font-bold shadow-sm";
            } else if (isUserChoice && !isCorrectOption) {
              optionStyles += "bg-red-50 border-red-500 text-red-800 font-bold shadow-sm";
            } else {
              optionStyles += "bg-slate-50 border-slate-50 text-slate-400 opacity-60";
            }
          }

          return (
            <label key={i} className={optionStyles}>
              <input
                type="checkbox"
                name={`q-${index}`}
                value={option}
                checked={isUserChoice}
                onChange={() => onToggle(option)}
                disabled={isChecked}
                className="hidden"
              />
              <span className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center shrink-0 transition-colors ${
                isUserChoice 
                  ? (isChecked ? (isCorrectOption ? 'border-green-600 bg-white' : 'border-red-600 bg-white') : 'border-white bg-white') 
                  : 'border-slate-300 bg-white'
              }`}>
                {isUserChoice && (
                  isChecked && !isCorrectOption ? <AlertCircle size={14} className="text-red-600" /> : <CheckSquare size={14} className={isChecked ? 'text-green-600' : 'text-slate-800'} />
                )}
                {!isUserChoice && isChecked && isCorrectOption && <CheckSquare size={14} className="text-green-600/50" />}
              </span>
              <span className="text-base">{option}</span>
            </label>
          );
        })}
      </div>

      {!isChecked ? (
        <button
          onClick={onCheck}
          disabled={selectedAnswers.length === 0}
          className={`mt-8 w-full py-5 rounded-[2rem] font-black uppercase tracking-widest text-sm transition-all flex items-center justify-center gap-3 ${
            selectedAnswers.length > 0
              ? 'bg-slate-900 text-white hover:bg-slate-700 shadow-xl active:scale-95' 
              : 'bg-slate-100 text-slate-400 cursor-not-allowed'
          }`}
        >
          Ellenőrzés
          <ChevronRight size={18} />
        </button>
      ) : (
        <div className={`mt-8 p-6 rounded-[2.5rem] animate-in fade-in zoom-in slide-in-from-top-4 duration-500 ${
          isCorrect ? 'bg-green-50 text-green-900 border-l-8 border-green-500' : 'bg-red-50 text-red-900 border-l-8 border-red-500'
        }`}>
          <div className="flex items-center gap-3 mb-3 font-black text-xs uppercase tracking-[0.1em]">
            {isCorrect ? <CheckCircle2 size={18} className="text-green-600" /> : <AlertCircle size={18} className="text-red-600" />}
            {isCorrect ? 'Kiváló' : `Megoldás: ${question.correct_answers.join(", ")}`}
          </div>
          <div className="text-sm leading-relaxed space-y-4">
            <p className="bg-white/40 p-4 rounded-2xl italic font-medium text-slate-600">
              "Eredetileg a(z) {question.original_index}. kérdés a dokumentumban."
            </p>
            <div className="pl-1">
              <span className="font-black text-[10px] uppercase text-slate-400 block mb-2 tracking-widest">Miért ez a válasz?</span>
              {question.explanation}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;