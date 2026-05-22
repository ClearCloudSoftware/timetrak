import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5_000, refetchOnWindowFocus: false },
  },
});

export const qk = {
  categories: ['categories'] as const,
  projects: ['projects'] as const,
  entries: (startUtc: string, endUtc: string) =>
    ['entries', startUtc, endUtc] as const,
  timerState: ['timer-state'] as const,
};
