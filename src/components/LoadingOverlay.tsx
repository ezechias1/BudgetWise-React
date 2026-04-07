interface Props {
  hidden?: boolean;
}

/** Matches the vanilla `.loading-overlay` + `.loading-spinner` markup. */
export function LoadingOverlay({ hidden }: Props) {
  return (
    <div className={`loading-overlay ${hidden ? 'hidden' : ''}`}>
      <div className="loading-spinner" />
    </div>
  );
}
