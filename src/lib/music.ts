import { Midi } from "@tonejs/midi";
import type { ReferenceNote } from "../types";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function frequencyToMidi(frequencyHz: number): number {
  return 69 + 12 * Math.log2(frequencyHz / 440);
}

export function frequencyToNoteName(frequencyHz: number): string {
  const midi = Math.round(frequencyToMidi(frequencyHz));
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${octave}`;
}

export function centsBetween(sourceHz: number, targetHz: number): number {
  return 1200 * Math.log2(sourceHz / targetHz);
}

export function noteNameFromMidi(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${octave}`;
}

export async function parseMidiFile(file: File): Promise<ReferenceNote[]> {
  const buffer = await file.arrayBuffer();
  const midi = new Midi(buffer);
  return extractReferenceNotes(midi);
}

export function extractReferenceNotes(midi: Midi): ReferenceNote[] {
  const notes = midi.tracks
    .flatMap((track, trackIndex) =>
      track.notes.map((note, noteIndex) => ({
        id: `${trackIndex}-${noteIndex}`,
        startMs: note.time * 1000,
        endMs: (note.time + note.duration) * 1000,
        midi: note.midi,
        frequencyHz: midiToFrequency(note.midi),
        name: note.name || noteNameFromMidi(note.midi)
      }))
    )
    .filter((note) => note.endMs > note.startMs)
    .sort((a, b) => a.startMs - b.startMs);

  return notes;
}

export function createDemoReference(): ReferenceNote[] {
  const melody = [
    [60, 0, 500],
    [62, 500, 500],
    [64, 1000, 500],
    [65, 1500, 500],
    [67, 2000, 700],
    [65, 2700, 350],
    [64, 3050, 350],
    [62, 3400, 600],
    [60, 4000, 900]
  ];

  return melody.map(([midi, startMs, durationMs], index) => ({
    id: `demo-${index}`,
    startMs,
    endMs: startMs + durationMs,
    midi,
    frequencyHz: midiToFrequency(midi),
    name: noteNameFromMidi(midi)
  }));
}

export function getReferenceAt(notes: ReferenceNote[], timeMs: number): ReferenceNote | null {
  return notes.find((note) => timeMs >= note.startMs && timeMs <= note.endMs) ?? null;
}

export function getReferenceDuration(notes: ReferenceNote[]): number {
  return notes.reduce((max, note) => Math.max(max, note.endMs), 0);
}
