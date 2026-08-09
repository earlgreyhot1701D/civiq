'use client';

// The print stylesheet in globals.css strips the chrome and keeps the cards and
// their receipts. A resident who walks into a meeting holding paper is the point.
export default function PrintButton() {
  return (
    <div className="toolbar">
      <button type="button" className="ghost" onClick={() => window.print()}>
        Save this page as a PDF
      </button>
    </div>
  );
}
