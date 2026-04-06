# Signal Sentences

This folder contains sentence templates for each signal type. Each file contains 10 sentences that escalate in tone from calm to serious.

## File Format

- Each file corresponds to a signal key (e.g., `lastUpdated.txt`, `timeInColumn.txt`)
- One sentence per line (exactly 10 lines)
- Use `{duration}` placeholder for time values

## Tone Categories

The sentences are organized by line number to match different frustration levels:

- **Lines 1-3 (Calm)**: Used when frustration score is 0-30
  - Polite, understanding, patient tone
  - Examples: "Just checking in!", "No rush though"

- **Lines 4-7 (Cheeky)**: Used when frustration score is 31-70
  - Slightly frustrated, sarcastic, humorous tone
  - Examples: "Am I invisible?", "Feeling forgotten"

- **Lines 8-10 (Serious)**: Used when frustration score is 71-100
  - Urgent, serious, demanding attention
  - Examples: "This is ridiculous", "Completely unacceptable"

## How It Works

1. The system calculates the ticket's overall frustration score (0-100)
2. Based on the score, it determines the appropriate tone category
3. A random sentence from that category is selected
4. The `{duration}` placeholder is replaced with the actual time value
5. The ticket "speaks" this personalized complaint

## Adding New Signals

To add support for a new signal:
1. Create a new `.txt` file named after the signal key
2. Add 10 sentences following the tone progression
3. Include the `{duration}` placeholder where appropriate
