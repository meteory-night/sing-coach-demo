const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function midiToFrequency(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function frequencyToMidi(frequencyHz) {
  return 69 + 12 * Math.log2(frequencyHz / 440);
}

function centsBetween(sourceHz, targetHz) {
  return 1200 * Math.log2(sourceHz / targetHz);
}

function noteNameFromMidi(midi) {
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${octave}`;
}

function createDemoReference() {
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

function parseMidiArrayBuffer(buffer) {
  const reader = createReader(buffer);
  if (reader.readString(4) !== "MThd") {
    throw new Error("不是有效的 MIDI 文件。");
  }

  const headerLength = reader.readUint32();
  const format = reader.readUint16();
  const trackCount = reader.readUint16();
  const division = reader.readUint16();
  if (division & 0x8000) {
    throw new Error("暂不支持 SMPTE 时间格式的 MIDI。");
  }
  reader.skip(headerLength - 6);

  const ticksPerQuarter = division;
  const tracks = [];
  for (let trackIndex = 0; trackIndex < trackCount; trackIndex += 1) {
    if (reader.readString(4) !== "MTrk") {
      throw new Error("MIDI 轨道数据损坏。");
    }
    const trackLength = reader.readUint32();
    const trackEnd = reader.offset + trackLength;
    tracks.push(parseTrack(reader, trackEnd, ticksPerQuarter, trackIndex));
    reader.offset = trackEnd;
  }

  const notes = chooseMelodyTrack(tracks)
    .map((note, index) => ({
      id: `midi-${index}`,
      startMs: Math.round(note.startMs),
      endMs: Math.round(note.endMs),
      midi: note.midi,
      frequencyHz: midiToFrequency(note.midi),
      name: noteNameFromMidi(note.midi)
    }))
    .filter((note) => note.endMs > note.startMs)
    .sort((a, b) => a.startMs - b.startMs);

  return makeMonophonic(notes);
}

function parseTrack(reader, trackEnd, ticksPerQuarter, trackIndex) {
  let tick = 0;
  let tempo = 500000;
  let runningStatus = null;
  const activeNotes = new Map();
  const notes = [];

  while (reader.offset < trackEnd) {
    tick += reader.readVariableLength();
    let status = reader.readUint8();
    if (status < 0x80) {
      if (runningStatus === null) throw new Error("MIDI running status 无效。");
      reader.offset -= 1;
      status = runningStatus;
    } else if (status < 0xf0) {
      runningStatus = status;
    }

    if (status === 0xff) {
      const metaType = reader.readUint8();
      const length = reader.readVariableLength();
      if (metaType === 0x51 && length === 3) {
        tempo = (reader.readUint8() << 16) | (reader.readUint8() << 8) | reader.readUint8();
      } else {
        reader.skip(length);
      }
      continue;
    }

    if (status === 0xf0 || status === 0xf7) {
      reader.skip(reader.readVariableLength());
      continue;
    }

    const eventType = status & 0xf0;
    const channel = status & 0x0f;
    const timeMs = ticksToMs(tick, ticksPerQuarter, tempo);

    if (eventType === 0x90 || eventType === 0x80) {
      const midi = reader.readUint8();
      const velocity = reader.readUint8();
      const key = `${channel}-${midi}`;
      if (eventType === 0x90 && velocity > 0) {
        activeNotes.set(key, { midi, startMs: timeMs, channel, trackIndex });
      } else {
        const active = activeNotes.get(key);
        if (active) {
          notes.push({ ...active, endMs: timeMs });
          activeNotes.delete(key);
        }
      }
      continue;
    }

    if (eventType === 0xc0 || eventType === 0xd0) {
      reader.skip(1);
    } else {
      reader.skip(2);
    }
  }

  return notes;
}

function chooseMelodyTrack(tracks) {
  const candidates = tracks
    .map((notes, trackIndex) => ({
      trackIndex,
      notes: notes.filter((note) => note.channel !== 9),
      score: notes.length ? average(notes.map((note) => note.midi)) + Math.min(notes.length, 80) : 0
    }))
    .filter((track) => track.notes.length > 0)
    .sort((a, b) => b.score - a.score);

  if (candidates.length) return candidates[0].notes;
  return tracks.flat();
}

function makeMonophonic(notes) {
  const sorted = [...notes].sort((a, b) => a.startMs - b.startMs || b.midi - a.midi);
  const result = [];
  for (const note of sorted) {
    const previous = result[result.length - 1];
    if (!previous || note.startMs >= previous.endMs) {
      result.push({ ...note });
      continue;
    }
    if (note.midi > previous.midi) {
      previous.endMs = Math.min(previous.endMs, note.startMs);
      if (previous.endMs <= previous.startMs) result.pop();
      result.push({ ...note });
    }
  }
  return result.filter((note) => note.endMs > note.startMs);
}

function ticksToMs(ticks, ticksPerQuarter, tempo) {
  return (ticks * tempo) / ticksPerQuarter / 1000;
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

function createReader(buffer) {
  const view = new DataView(buffer);
  return {
    offset: 0,
    readUint8() {
      const value = view.getUint8(this.offset);
      this.offset += 1;
      return value;
    },
    readUint16() {
      const value = view.getUint16(this.offset, false);
      this.offset += 2;
      return value;
    },
    readUint32() {
      const value = view.getUint32(this.offset, false);
      this.offset += 4;
      return value;
    },
    readString(length) {
      let text = "";
      for (let i = 0; i < length; i += 1) {
        text += String.fromCharCode(this.readUint8());
      }
      return text;
    },
    readVariableLength() {
      let value = 0;
      let byte = 0;
      do {
        byte = this.readUint8();
        value = (value << 7) | (byte & 0x7f);
      } while (byte & 0x80);
      return value;
    },
    skip(length) {
      this.offset += Math.max(0, length);
    }
  };
}

function getReferenceAt(notes, timeMs) {
  return notes.find((note) => timeMs >= note.startMs && timeMs <= note.endMs) || null;
}

function getReferenceDuration(notes) {
  return notes.reduce((max, note) => Math.max(max, note.endMs), 0);
}

module.exports = {
  centsBetween,
  createDemoReference,
  frequencyToMidi,
  getReferenceAt,
  getReferenceDuration,
  midiToFrequency,
  parseMidiArrayBuffer
};
