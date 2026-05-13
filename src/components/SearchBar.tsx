interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  resultCount: number;
}

export function SearchBar({ value, onChange, resultCount }: SearchBarProps) {
  return (
    <div className="search-bar">
      <input
        type="search"
        placeholder="Suche nach Name, Institution oder Thema..."
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <span className="status-pill">{resultCount} Treffer</span>
    </div>
  );
}
