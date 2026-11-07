// The yard's icon (ink tile, pink flag), drawn for next/og's ImageResponse: app/icon.tsx and app/apple-icon.tsx.
export function Flag({ size, padded, rounded = 0 }: { size: number; padded?: boolean; rounded?: number }) {
  const inner = size * (padded ? 0.46 : 0.6);
  return (
    <div style={{ width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center", background: "#1c1b19", borderRadius: rounded }}>
      <svg width={inner * (22 / 26)} height={inner} viewBox="0 0 22 26">
        <path d="M3 1v25" stroke="#f6f4ef" strokeWidth="2.6" />
        <path d="M4 2h16l-5 6 5 6H4z" fill="#E0335F" />
      </svg>
    </div>
  );
}
