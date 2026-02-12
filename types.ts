
export interface QuizQuestion {
  question: string;
  options: string[];
  correct_answers: string[]; // Changed from single correct_answer to array
  explanation: string;
  original_index: string;
}

export interface QuizState {
  questions: QuizQuestion[];
  userAnswers: Record<number, string[]>; // Changed from string to string array
  checkedQuestions: Set<number>;
  isLoading: boolean;
  error: string | null;
}
