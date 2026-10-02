/** Bound a broken local decoder's question-mark run across stream chunks.
 * This stops generation; it never rewrites the model's answer or guesses its language.
 */
export class RepetitionStop {
  private run = 0

  push(text: string): boolean {
    for (const char of text) {
      this.run = char === '?' ? this.run + 1 : 0
      if (this.run >= 256) return true
    }
    return false
  }
}
