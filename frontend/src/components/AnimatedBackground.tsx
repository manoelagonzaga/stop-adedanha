/**
 * Animated background with floating geometric shapes.
 * Respects prefers-reduced-motion: animations are removed for users who prefer reduced motion.
 */
export function AnimatedBackground() {
  return (
    <div
      className="fixed inset-0 -z-10 overflow-hidden"
      aria-hidden="true"
      style={{ background: 'linear-gradient(135deg, #f5f0eb 0%, #ede8e1 50%, #e8e2da 100%)' }}
    >
      {/* Shape 1 — top-left */}
      <div className="bg-shape bg-shape--1" />
      {/* Shape 2 — top-right */}
      <div className="bg-shape bg-shape--2" />
      {/* Shape 3 — bottom-center */}
      <div className="bg-shape bg-shape--3" />
      {/* Shape 4 — bottom-left */}
      <div className="bg-shape bg-shape--4" />
    </div>
  );
}

