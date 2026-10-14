export default function Toast({ message, onUndo }) {
  if (!message) return null;
  return (
    <div className="tst" role="status">
      <span>{message}</span>
      {onUndo && <button type="button" onClick={onUndo}>Undo</button>}
    </div>
  );
}