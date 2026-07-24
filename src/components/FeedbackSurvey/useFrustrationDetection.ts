import type { Message } from '../../types/message.js'
import type { TranscriptShareResponse } from './TranscriptSharePrompt.js'

export function useFrustrationDetection(
  _messages?: Message[],
  _isLoading?: boolean,
  _hasActivePrompt?: boolean,
  _hasOpenSurvey?: boolean,
): {
  state: 'closed' | 'open' | 'thanks' | 'transcript_prompt' | 'submitting' | 'submitted'
  handleTranscriptSelect: (selected: TranscriptShareResponse) => void
} {
  return {
    state: 'closed',
    handleTranscriptSelect: () => {},
  }
}
