import {
  getStoredTestDifficulty,
  getTestDifficultyOption,
  setStoredTestDifficulty,
  TEST_DIFFICULTY_OPTIONS,
  type TestDifficulty,
} from "../lib/testDifficulty";

type Props = {
  value: TestDifficulty;
  onChange: (value: TestDifficulty) => void;
  disabled?: boolean;
  compact?: boolean;
};

export function TestDifficultyPicker({
  value,
  onChange,
  disabled,
  compact,
}: Props) {
  const selected = getTestDifficultyOption(value);

  return (
    <label
      className={`flex flex-col gap-1 text-sm text-on-surface ${compact ? "" : "w-full max-w-md"}`}
    >
      Poziom trudności
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const next = e.target.value as TestDifficulty;
          onChange(next);
          setStoredTestDifficulty(next);
        }}
        className="rounded-lg border border-outline-variant bg-surface-container px-3 py-2 text-on-surface text-sm"
      >
        {TEST_DIFFICULTY_OPTIONS.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.label}
          </option>
        ))}
      </select>
      <span className="text-xs text-on-surface-variant font-normal">
        {selected.hint}
      </span>
    </label>
  );
}

export { getStoredTestDifficulty, type TestDifficulty };
