import Database from "@tauri-apps/plugin-sql";

let dbPromise: Promise<Database> | null = null;

export async function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = Database.load("sqlite:edumelon.db").then(async (db) => {
      await migrate(db);
      return db;
    });
  }
  return dbPromise;
}

async function tableHasColumn(
  db: Database,
  table: string,
  column: string,
): Promise<boolean> {
  const rows = await db.select<{ name: string }[]>(
    `PRAGMA table_info(${table})`,
  );
  return rows.some((r) => r.name === column);
}

async function migrate(db: Database): Promise<void> {
  await db.execute("PRAGMA foreign_keys = ON;");
  await db.execute(`
    CREATE TABLE IF NOT EXISTS presentations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      subject TEXT,
      file_path TEXT,
      source_kind TEXT NOT NULL,
      raw_text_preview TEXT,
      created_at TEXT NOT NULL
    );
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS subject_folders (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  if (!(await tableHasColumn(db, "presentations", "folder_id"))) {
    await db.execute(`ALTER TABLE presentations ADD COLUMN folder_id TEXT`);
  }
  await db.execute(`
    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      presentation_id TEXT NOT NULL,
      slide_index INTEGER,
      body TEXT NOT NULL,
      embedding TEXT,
      FOREIGN KEY (presentation_id) REFERENCES presentations(id) ON DELETE CASCADE
    );
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS flashcards (
      id TEXT PRIMARY KEY,
      presentation_id TEXT NOT NULL,
      front TEXT NOT NULL,
      back TEXT NOT NULL,
      ease REAL DEFAULT 2.5,
      repetitions INTEGER DEFAULT 0,
      FOREIGN KEY (presentation_id) REFERENCES presentations(id) ON DELETE CASCADE
    );
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS summaries (
      presentation_id TEXT PRIMARY KEY,
      short_text TEXT,
      full_text TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (presentation_id) REFERENCES presentations(id) ON DELETE CASCADE
    );
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS tests (
      presentation_id TEXT PRIMARY KEY,
      generated_at TEXT NOT NULL,
      question_count INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (presentation_id) REFERENCES presentations(id) ON DELETE CASCADE
    );
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS test_questions (
      id TEXT PRIMARY KEY,
      presentation_id TEXT NOT NULL,
      slide_index INTEGER,
      question TEXT NOT NULL,
      option_a TEXT NOT NULL,
      option_b TEXT NOT NULL,
      option_c TEXT NOT NULL,
      option_d TEXT NOT NULL,
      correct_option TEXT NOT NULL,
      explanation TEXT,
      requires_image INTEGER NOT NULL DEFAULT 0,
      crop_x REAL,
      crop_y REAL,
      crop_w REAL,
      crop_h REAL,
      FOREIGN KEY (presentation_id) REFERENCES presentations(id) ON DELETE CASCADE
    );
  `);
  if (!(await tableHasColumn(db, "test_questions", "requires_image"))) {
    await db.execute(
      `ALTER TABLE test_questions ADD COLUMN requires_image INTEGER NOT NULL DEFAULT 0`,
    );
  }
  if (!(await tableHasColumn(db, "test_questions", "crop_x"))) {
    await db.execute(`ALTER TABLE test_questions ADD COLUMN crop_x REAL`);
  }
  if (!(await tableHasColumn(db, "test_questions", "crop_y"))) {
    await db.execute(`ALTER TABLE test_questions ADD COLUMN crop_y REAL`);
  }
  if (!(await tableHasColumn(db, "test_questions", "crop_w"))) {
    await db.execute(`ALTER TABLE test_questions ADD COLUMN crop_w REAL`);
  }
  if (!(await tableHasColumn(db, "test_questions", "crop_h"))) {
    await db.execute(`ALTER TABLE test_questions ADD COLUMN crop_h REAL`);
  }
  await db.execute(`
    CREATE TABLE IF NOT EXISTS test_attempts (
      id TEXT PRIMARY KEY,
      presentation_id TEXT NOT NULL,
      score_percent REAL NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (presentation_id) REFERENCES presentations(id) ON DELETE CASCADE
    );
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS test_attempt_answers (
      id TEXT PRIMARY KEY,
      attempt_id TEXT NOT NULL,
      question_id TEXT NOT NULL,
      selected_option TEXT NOT NULL,
      is_correct INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (attempt_id) REFERENCES test_attempts(id) ON DELETE CASCADE,
      FOREIGN KEY (question_id) REFERENCES test_questions(id) ON DELETE CASCADE
    );
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS study_events (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      event_type TEXT NOT NULL,
      deadline_at TEXT NOT NULL,
      notes TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS study_event_materials (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      presentation_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (event_id) REFERENCES study_events(id) ON DELETE CASCADE,
      FOREIGN KEY (presentation_id) REFERENCES presentations(id) ON DELETE CASCADE
    );
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS study_event_reminders (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      offset_minutes INTEGER NOT NULL,
      scheduled_for TEXT NOT NULL,
      fired_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (event_id) REFERENCES study_events(id) ON DELETE CASCADE
    );
  `);
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_study_events_deadline ON study_events(deadline_at)`,
  );
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_study_event_materials_event ON study_event_materials(event_id)`,
  );
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_study_event_materials_presentation ON study_event_materials(presentation_id)`,
  );
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_study_event_reminders_event ON study_event_reminders(event_id)`,
  );
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_study_event_reminders_scheduled ON study_event_reminders(scheduled_for)`,
  );
}

export type PresentationRow = {
  id: string;
  title: string;
  subject: string | null;
  folder_id: string | null;
  file_path: string | null;
  source_kind: string;
  raw_text_preview: string | null;
  created_at: string;
};

/** Lista z JOIN — kolor i nazwa folderu do UI. */
export type PresentationListRow = PresentationRow & {
  folder_color: string | null;
  folder_name: string | null;
};

export type SubjectFolderRow = {
  id: string;
  name: string;
  color: string;
  created_at: string;
};

export async function insertPresentation(
  row: Omit<PresentationRow, "id" | "created_at"> & { id?: string },
): Promise<string> {
  const db = await getDb();
  const id = row.id ?? crypto.randomUUID();
  const created_at = new Date().toISOString();
  await db.execute(
    `INSERT INTO presentations (id, title, subject, folder_id, file_path, source_kind, raw_text_preview, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      row.title,
      row.subject ?? null,
      row.folder_id ?? null,
      row.file_path ?? null,
      row.source_kind,
      row.raw_text_preview ?? null,
      created_at,
    ],
  );
  return id;
}

export async function listSubjectFolders(): Promise<SubjectFolderRow[]> {
  const db = await getDb();
  return db.select<SubjectFolderRow[]>(
    `SELECT id, name, color, created_at FROM subject_folders ORDER BY name COLLATE NOCASE ASC`,
  );
}

export async function getSubjectFolder(
  id: string,
): Promise<SubjectFolderRow | null> {
  const db = await getDb();
  const rows = await db.select<SubjectFolderRow[]>(
    `SELECT id, name, color, created_at FROM subject_folders WHERE id = $1 LIMIT 1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function insertSubjectFolder(
  name: string,
  color: string,
): Promise<string> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const created_at = new Date().toISOString();
  await db.execute(
    `INSERT INTO subject_folders (id, name, color, created_at) VALUES ($1, $2, $3, $4)`,
    [id, name.trim(), color, created_at],
  );
  return id;
}

export async function listPresentations(): Promise<PresentationListRow[]> {
  const db = await getDb();
  const rows = await db.select<PresentationListRow[]>(
    `SELECT p.id, p.title, p.subject, p.folder_id, p.file_path, p.source_kind, p.raw_text_preview, p.created_at,
            f.name AS folder_name, f.color AS folder_color
     FROM presentations p
     LEFT JOIN subject_folders f ON p.folder_id = f.id
     ORDER BY p.created_at DESC`,
  );
  return rows;
}

export async function getPresentation(
  id: string,
): Promise<PresentationListRow | null> {
  const db = await getDb();
  const rows = await db.select<PresentationListRow[]>(
    `SELECT p.id, p.title, p.subject, p.folder_id, p.file_path, p.source_kind, p.raw_text_preview, p.created_at,
            f.name AS folder_name, f.color AS folder_color
     FROM presentations p
     LEFT JOIN subject_folders f ON p.folder_id = f.id
     WHERE p.id = $1 LIMIT 1`,
    [id],
  );
  return rows[0] ?? null;
}

export type ChunkRow = {
  id: string;
  presentation_id: string;
  slide_index: number | null;
  body: string;
  embedding: string | null;
};

export async function insertChunks(chunks: ChunkRow[]): Promise<void> {
  const db = await getDb();
  for (const c of chunks) {
    await db.execute(
      `INSERT INTO chunks (id, presentation_id, slide_index, body, embedding)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        c.id,
        c.presentation_id,
        c.slide_index,
        c.body,
        c.embedding,
      ],
    );
  }
}

export async function listChunksForPresentation(
  presentationId: string,
): Promise<ChunkRow[]> {
  const db = await getDb();
  return db.select<ChunkRow[]>(
    `SELECT id, presentation_id, slide_index, body, embedding FROM chunks
     WHERE presentation_id = $1 ORDER BY (slide_index IS NULL), slide_index ASC, id ASC`,
    [presentationId],
  );
}

export async function deleteChunksForPresentation(
  presentationId: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM chunks WHERE presentation_id = $1`, [
    presentationId,
  ]);
}

export type FlashcardRow = {
  id: string;
  presentation_id: string;
  front: string;
  back: string;
  ease: number;
  repetitions: number;
};

export async function insertFlashcards(
  cards: Omit<FlashcardRow, "ease" | "repetitions">[],
): Promise<void> {
  const db = await getDb();
  for (const c of cards) {
    await db.execute(
      `INSERT INTO flashcards (id, presentation_id, front, back, ease, repetitions)
       VALUES ($1, $2, $3, $4, 2.5, 0)`,
      [c.id, c.presentation_id, c.front, c.back],
    );
  }
}

export async function listFlashcards(
  presentationId: string,
): Promise<FlashcardRow[]> {
  const db = await getDb();
  return db.select<FlashcardRow[]>(
    `SELECT id, presentation_id, front, back, ease, repetitions FROM flashcards
     WHERE presentation_id = $1 ORDER BY id ASC`,
    [presentationId],
  );
}

export async function updateFlashcardProgress(
  id: string,
  repetitions: number,
  ease: number,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE flashcards SET repetitions = $1, ease = $2 WHERE id = $3`,
    [repetitions, ease, id],
  );
}

export async function deleteFlashcardsForPresentation(
  presentationId: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM flashcards WHERE presentation_id = $1`, [
    presentationId,
  ]);
}

export type SummaryRow = {
  presentation_id: string;
  short_text: string | null;
  full_text: string | null;
  updated_at: string;
};

export async function getSummaryForPresentation(
  presentationId: string,
): Promise<SummaryRow | null> {
  const db = await getDb();
  const rows = await db.select<SummaryRow[]>(
    `SELECT presentation_id, short_text, full_text, updated_at
     FROM summaries
     WHERE presentation_id = $1
     LIMIT 1`,
    [presentationId],
  );
  return rows[0] ?? null;
}

export async function upsertSummaryForPresentation(
  presentationId: string,
  shortText: string | null,
  fullText: string | null,
): Promise<void> {
  const db = await getDb();
  const updatedAt = new Date().toISOString();
  await db.execute(
    `INSERT INTO summaries (presentation_id, short_text, full_text, updated_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT(presentation_id) DO UPDATE SET
       short_text = excluded.short_text,
       full_text = excluded.full_text,
       updated_at = excluded.updated_at`,
    [presentationId, shortText, fullText, updatedAt],
  );
}

export type TestQuestionOption = "A" | "B" | "C" | "D";

export type TestQuestionRow = {
  id: string;
  presentation_id: string;
  slide_index: number | null;
  question: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_option: TestQuestionOption;
  explanation: string | null;
  requires_image: number;
  crop_x: number | null;
  crop_y: number | null;
  crop_w: number | null;
  crop_h: number | null;
};

export type TestMetaRow = {
  presentation_id: string;
  generated_at: string;
  question_count: number;
};

export type TestAttemptRow = {
  id: string;
  presentation_id: string;
  score_percent: number;
  created_at: string;
};

export type TestAttemptAnswerRow = {
  id: string;
  attempt_id: string;
  question_id: string;
  selected_option: TestQuestionOption;
  is_correct: number;
};

export type TestWrongAnswerRow = {
  question_id: string;
  question: string;
  slide_index: number | null;
  selected_option: TestQuestionOption;
  correct_option: TestQuestionOption;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  explanation: string | null;
  requires_image: number;
  crop_x: number | null;
  crop_y: number | null;
  crop_w: number | null;
  crop_h: number | null;
};

export type TestAttemptQuestionReviewRow = {
  question_id: string;
  slide_index: number | null;
  question: string;
  selected_option: TestQuestionOption;
  correct_option: TestQuestionOption;
  is_correct: number;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  explanation: string | null;
  requires_image: number;
  crop_x: number | null;
  crop_y: number | null;
  crop_w: number | null;
  crop_h: number | null;
};

export async function getTestMetaForPresentation(
  presentationId: string,
): Promise<TestMetaRow | null> {
  const db = await getDb();
  const rows = await db.select<TestMetaRow[]>(
    `SELECT presentation_id, generated_at, question_count
     FROM tests
     WHERE presentation_id = $1
     LIMIT 1`,
    [presentationId],
  );
  return rows[0] ?? null;
}

export async function listTestQuestionsForPresentation(
  presentationId: string,
): Promise<TestQuestionRow[]> {
  const db = await getDb();
  return db.select<TestQuestionRow[]>(
    `SELECT id, presentation_id, slide_index, question,
            option_a, option_b, option_c, option_d, correct_option, explanation,
            requires_image, crop_x, crop_y, crop_w, crop_h
     FROM test_questions
     WHERE presentation_id = $1
     ORDER BY (slide_index IS NULL), slide_index ASC, id ASC`,
    [presentationId],
  );
}

export async function saveTestQuestionBank(
  presentationId: string,
  questions: Omit<TestQuestionRow, "presentation_id">[],
): Promise<void> {
  const db = await getDb();
  const generatedAt = new Date().toISOString();
  await db.execute(`DELETE FROM test_questions WHERE presentation_id = $1`, [
    presentationId,
  ]);
  for (const q of questions) {
    await db.execute(
      `INSERT INTO test_questions
       (id, presentation_id, slide_index, question, option_a, option_b, option_c, option_d, correct_option, explanation, requires_image, crop_x, crop_y, crop_w, crop_h)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        q.id,
        presentationId,
        q.slide_index,
        q.question,
        q.option_a,
        q.option_b,
        q.option_c,
        q.option_d,
        q.correct_option,
        q.explanation ?? null,
        q.requires_image ?? 0,
        q.crop_x ?? null,
        q.crop_y ?? null,
        q.crop_w ?? null,
        q.crop_h ?? null,
      ],
    );
  }
  await db.execute(
    `INSERT INTO tests (presentation_id, generated_at, question_count)
     VALUES ($1, $2, $3)
     ON CONFLICT(presentation_id) DO UPDATE SET
       generated_at = excluded.generated_at,
       question_count = excluded.question_count`,
    [presentationId, generatedAt, questions.length],
  );
}

export async function saveTestAttempt(
  presentationId: string,
  scorePercent: number,
  answers: Omit<TestAttemptAnswerRow, "id" | "attempt_id">[],
): Promise<string> {
  const db = await getDb();
  const attemptId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await db.execute(
    `INSERT INTO test_attempts (id, presentation_id, score_percent, created_at)
     VALUES ($1, $2, $3, $4)`,
    [attemptId, presentationId, scorePercent, createdAt],
  );
  for (const a of answers) {
    await db.execute(
      `INSERT INTO test_attempt_answers
       (id, attempt_id, question_id, selected_option, is_correct)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        crypto.randomUUID(),
        attemptId,
        a.question_id,
        a.selected_option,
        a.is_correct,
      ],
    );
  }
  return attemptId;
}

export async function listWrongAnswersForAttempt(
  attemptId: string,
): Promise<TestWrongAnswerRow[]> {
  const db = await getDb();
  return db.select<TestWrongAnswerRow[]>(
    `SELECT q.id AS question_id, q.question, q.slide_index,
            a.selected_option, q.correct_option,
            q.option_a, q.option_b, q.option_c, q.option_d, q.explanation,
            q.requires_image, q.crop_x, q.crop_y, q.crop_w, q.crop_h
     FROM test_attempt_answers a
     JOIN test_questions q ON q.id = a.question_id
     WHERE a.attempt_id = $1 AND a.is_correct = 0
     ORDER BY (q.slide_index IS NULL), q.slide_index ASC, q.id ASC`,
    [attemptId],
  );
}

export async function listRecentAttemptsForPresentation(
  presentationId: string,
): Promise<TestAttemptRow[]> {
  const db = await getDb();
  return db.select<TestAttemptRow[]>(
    `SELECT id, presentation_id, score_percent, created_at
     FROM test_attempts
     WHERE presentation_id = $1
     ORDER BY created_at DESC`,
    [presentationId],
  );
}

export async function listAttemptQuestionReviews(
  attemptId: string,
): Promise<TestAttemptQuestionReviewRow[]> {
  const db = await getDb();
  return db.select<TestAttemptQuestionReviewRow[]>(
    `SELECT q.id AS question_id, q.slide_index, q.question,
            a.selected_option, q.correct_option, a.is_correct,
            q.option_a, q.option_b, q.option_c, q.option_d, q.explanation,
            q.requires_image, q.crop_x, q.crop_y, q.crop_w, q.crop_h
     FROM test_attempt_answers a
     JOIN test_questions q ON q.id = a.question_id
     WHERE a.attempt_id = $1
     ORDER BY (q.slide_index IS NULL), q.slide_index ASC, q.id ASC`,
    [attemptId],
  );
}

export type StudyEventType = "kolokwium" | "wejsciowka" | "egzamin" | "projekt";

export type StudyEventRow = {
  id: string;
  title: string;
  event_type: StudyEventType;
  deadline_at: string;
  notes: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type StudyEventMaterialRow = {
  id: string;
  event_id: string;
  presentation_id: string;
  created_at: string;
};

export type StudyEventReminderRow = {
  id: string;
  event_id: string;
  offset_minutes: number;
  scheduled_for: string;
  fired_at: string | null;
  created_at: string;
};

export type StudyEventWithMaterialsRow = StudyEventRow & {
  materials_count: number;
};

export type StudyEventReminderAlertRow = {
  reminder_id: string;
  event_id: string;
  event_title: string;
  event_type: StudyEventType;
  deadline_at: string;
  offset_minutes: number;
  scheduled_for: string;
};

export async function createStudyEvent(input: {
  title: string;
  eventType: StudyEventType;
  deadlineAt: string;
  notes?: string | null;
  presentationIds?: string[];
  reminderOffsetsMinutes?: number[];
}): Promise<string> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.execute(
    `INSERT INTO study_events
     (id, title, event_type, deadline_at, notes, completed_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NULL, $6, $7)`,
    [id, input.title.trim(), input.eventType, input.deadlineAt, input.notes ?? null, now, now],
  );
  const ids = [...new Set(input.presentationIds ?? [])];
  for (const presentationId of ids) {
    await db.execute(
      `INSERT INTO study_event_materials (id, event_id, presentation_id, created_at)
       VALUES ($1, $2, $3, $4)`,
      [crypto.randomUUID(), id, presentationId, now],
    );
  }
  const offsets = [...new Set(input.reminderOffsetsMinutes ?? [10080, 1440, 120])];
  for (const offset of offsets) {
    const scheduledFor = new Date(
      new Date(input.deadlineAt).getTime() - offset * 60 * 1000,
    ).toISOString();
    await db.execute(
      `INSERT INTO study_event_reminders
       (id, event_id, offset_minutes, scheduled_for, fired_at, created_at)
       VALUES ($1, $2, $3, $4, NULL, $5)`,
      [crypto.randomUUID(), id, offset, scheduledFor, now],
    );
  }
  return id;
}

export async function updateStudyEvent(
  eventId: string,
  input: {
    title: string;
    eventType: StudyEventType;
    deadlineAt: string;
    notes?: string | null;
    presentationIds?: string[];
    reminderOffsetsMinutes?: number[];
  },
): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.execute(
    `UPDATE study_events
     SET title = $1, event_type = $2, deadline_at = $3, notes = $4, updated_at = $5
     WHERE id = $6`,
    [input.title.trim(), input.eventType, input.deadlineAt, input.notes ?? null, now, eventId],
  );
  await db.execute(`DELETE FROM study_event_materials WHERE event_id = $1`, [eventId]);
  for (const presentationId of [...new Set(input.presentationIds ?? [])]) {
    await db.execute(
      `INSERT INTO study_event_materials (id, event_id, presentation_id, created_at)
       VALUES ($1, $2, $3, $4)`,
      [crypto.randomUUID(), eventId, presentationId, now],
    );
  }
  await db.execute(`DELETE FROM study_event_reminders WHERE event_id = $1`, [eventId]);
  for (const offset of [...new Set(input.reminderOffsetsMinutes ?? [10080, 1440, 120])]) {
    const scheduledFor = new Date(
      new Date(input.deadlineAt).getTime() - offset * 60 * 1000,
    ).toISOString();
    await db.execute(
      `INSERT INTO study_event_reminders
       (id, event_id, offset_minutes, scheduled_for, fired_at, created_at)
       VALUES ($1, $2, $3, $4, NULL, $5)`,
      [crypto.randomUUID(), eventId, offset, scheduledFor, now],
    );
  }
}

export async function deleteStudyEvent(eventId: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM study_events WHERE id = $1`, [eventId]);
}

export async function markStudyEventCompleted(
  eventId: string,
  completed: boolean,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE study_events SET completed_at = $1, updated_at = $2 WHERE id = $3`,
    [completed ? new Date().toISOString() : null, new Date().toISOString(), eventId],
  );
}

export async function listStudyEvents(): Promise<StudyEventWithMaterialsRow[]> {
  const db = await getDb();
  return db.select<StudyEventWithMaterialsRow[]>(
    `SELECT e.id, e.title, e.event_type, e.deadline_at, e.notes, e.completed_at, e.created_at, e.updated_at,
            COUNT(m.id) AS materials_count
     FROM study_events e
     LEFT JOIN study_event_materials m ON m.event_id = e.id
     GROUP BY e.id
     ORDER BY e.deadline_at ASC`,
  );
}

export async function listUpcomingDeadlines(
  limit = 3,
): Promise<StudyEventWithMaterialsRow[]> {
  const db = await getDb();
  return db.select<StudyEventWithMaterialsRow[]>(
    `SELECT e.id, e.title, e.event_type, e.deadline_at, e.notes, e.completed_at, e.created_at, e.updated_at,
            COUNT(m.id) AS materials_count
     FROM study_events e
     LEFT JOIN study_event_materials m ON m.event_id = e.id
     WHERE e.completed_at IS NULL
     GROUP BY e.id
     ORDER BY e.deadline_at ASC
     LIMIT $1`,
    [limit],
  );
}

export async function listStudyEventMaterials(
  eventId: string,
): Promise<PresentationListRow[]> {
  const db = await getDb();
  return db.select<PresentationListRow[]>(
    `SELECT p.id, p.title, p.subject, p.folder_id, p.file_path, p.source_kind, p.raw_text_preview, p.created_at,
            f.name AS folder_name, f.color AS folder_color
     FROM study_event_materials sem
     JOIN presentations p ON p.id = sem.presentation_id
     LEFT JOIN subject_folders f ON p.folder_id = f.id
     WHERE sem.event_id = $1
     ORDER BY p.created_at DESC`,
    [eventId],
  );
}

export async function listPendingReminders(
  nowIso: string,
): Promise<StudyEventReminderAlertRow[]> {
  const db = await getDb();
  return db.select<StudyEventReminderAlertRow[]>(
    `SELECT r.id AS reminder_id, e.id AS event_id, e.title AS event_title, e.event_type, e.deadline_at,
            r.offset_minutes, r.scheduled_for
     FROM study_event_reminders r
     JOIN study_events e ON e.id = r.event_id
     WHERE r.fired_at IS NULL
       AND r.scheduled_for <= $1
       AND e.completed_at IS NULL
     ORDER BY r.scheduled_for ASC`,
    [nowIso],
  );
}

export async function markReminderFired(reminderId: string): Promise<void> {
  const db = await getDb();
  await db.execute(`UPDATE study_event_reminders SET fired_at = $1 WHERE id = $2`, [
    new Date().toISOString(),
    reminderId,
  ]);
}

export type ContinueLearningCard = {
  presentation_id: string;
  title: string;
  source_kind: string;
  last_activity_at: string;
};

export async function getContinueLearningCard(): Promise<ContinueLearningCard | null> {
  const db = await getDb();
  const testRows = await db.select<ContinueLearningCard[]>(
    `SELECT p.id AS presentation_id, p.title, p.source_kind, MAX(ta.created_at) AS last_activity_at
     FROM test_attempts ta
     JOIN presentations p ON p.id = ta.presentation_id
     GROUP BY p.id
     ORDER BY last_activity_at DESC
     LIMIT 1`,
  );
  if (testRows[0]) return testRows[0];
  const presentationRows = await db.select<ContinueLearningCard[]>(
    `SELECT id AS presentation_id, title, source_kind, created_at AS last_activity_at
     FROM presentations
     ORDER BY created_at DESC
     LIMIT 1`,
  );
  return presentationRows[0] ?? null;
}

export type TodayTasksSummary = {
  due_today_count: number;
  overdue_count: number;
  recommended_flashcards: number;
  wrong_questions: number;
};

export async function getTodayTasksSummary(): Promise<TodayTasksSummary> {
  const db = await getDb();
  const [dueToday] = await db.select<{ count: number }[]>(
    `SELECT COUNT(*) AS count
     FROM study_events
     WHERE date(deadline_at) = date('now', 'localtime')
       AND completed_at IS NULL`,
  );
  const [overdue] = await db.select<{ count: number }[]>(
    `SELECT COUNT(*) AS count
     FROM study_events
     WHERE datetime(deadline_at) < datetime('now', 'localtime')
       AND completed_at IS NULL`,
  );
  const [flashcards] = await db.select<{ count: number }[]>(
    `SELECT COUNT(*) AS count FROM flashcards`,
  );
  const [wrong] = await db.select<{ count: number }[]>(
    `SELECT COUNT(*) AS count
     FROM test_attempt_answers
     WHERE is_correct = 0`,
  );
  return {
    due_today_count: dueToday?.count ?? 0,
    overdue_count: overdue?.count ?? 0,
    recommended_flashcards: Math.min(40, Math.max(10, Math.floor((flashcards?.count ?? 0) / 5) || 20)),
    wrong_questions: wrong?.count ?? 0,
  };
}

export type WeeklyProgressStats = {
  active_days: number;
  tests_completed: number;
  avg_score_percent: number;
};

export async function getWeeklyProgressStats(): Promise<WeeklyProgressStats> {
  const db = await getDb();
  const [days] = await db.select<{ count: number }[]>(
    `SELECT COUNT(DISTINCT date(created_at)) AS count
     FROM test_attempts
     WHERE datetime(created_at) >= datetime('now', '-7 day')`,
  );
  const [tests] = await db.select<{ count: number }[]>(
    `SELECT COUNT(*) AS count
     FROM test_attempts
     WHERE datetime(created_at) >= datetime('now', '-7 day')`,
  );
  const [avgScore] = await db.select<{ avg: number | null }[]>(
    `SELECT AVG(score_percent) AS avg
     FROM test_attempts
     WHERE datetime(created_at) >= datetime('now', '-7 day')`,
  );
  return {
    active_days: days?.count ?? 0,
    tests_completed: tests?.count ?? 0,
    avg_score_percent: Math.round(avgScore?.avg ?? 0),
  };
}

export type WeakTopicRow = {
  presentation_id: string;
  title: string;
  wrong_count: number;
  total_count: number;
  wrong_ratio: number;
};

export async function getWeakTopics(limit = 5): Promise<WeakTopicRow[]> {
  const db = await getDb();
  return db.select<WeakTopicRow[]>(
    `SELECT p.id AS presentation_id, p.title,
            SUM(CASE WHEN taa.is_correct = 0 THEN 1 ELSE 0 END) AS wrong_count,
            COUNT(*) AS total_count,
            CAST(SUM(CASE WHEN taa.is_correct = 0 THEN 1 ELSE 0 END) AS REAL) / COUNT(*) AS wrong_ratio
     FROM test_attempt_answers taa
     JOIN test_attempts ta ON ta.id = taa.attempt_id
     JOIN presentations p ON p.id = ta.presentation_id
     GROUP BY p.id
     HAVING COUNT(*) >= 2
     ORDER BY wrong_ratio DESC, wrong_count DESC
     LIMIT $1`,
    [limit],
  );
}

export type RecentActivityRow = {
  kind: "test" | "material";
  title: string;
  meta: string;
  created_at: string;
  presentation_id: string | null;
};

export async function listRecentActivity(limit = 5): Promise<RecentActivityRow[]> {
  const db = await getDb();
  return db.select<RecentActivityRow[]>(
    `SELECT 'test' AS kind, p.title AS title,
            ('Wynik testu: ' || CAST(ROUND(ta.score_percent) AS TEXT) || '%') AS meta,
            ta.created_at, p.id AS presentation_id
     FROM test_attempts ta
     JOIN presentations p ON p.id = ta.presentation_id
     UNION ALL
     SELECT 'material' AS kind, p.title AS title,
            ('Dodano materiał (' || UPPER(p.source_kind) || ')') AS meta,
            p.created_at, p.id AS presentation_id
     FROM presentations p
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit],
  );
}

export async function getStudyStreak(): Promise<number> {
  const db = await getDb();
  const days = await db.select<{ d: string }[]>(
    `SELECT DISTINCT date(created_at) AS d
     FROM test_attempts
     ORDER BY d DESC`,
  );
  if (days.length === 0) return 0;
  const daySet = new Set(days.map((x) => x.d));
  let streak = 0;
  const cursor = new Date();
  while (true) {
    const day = cursor.toISOString().slice(0, 10);
    if (!daySet.has(day)) break;
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}
