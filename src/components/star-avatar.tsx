const gradients = [
  "from-violet-500 to-purple-600",
  "from-fuchsia-500 to-pink-600",
  "from-indigo-500 to-violet-600",
  "from-rose-500 to-orange-500",
];

function hashName(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
}

export function StarAvatar({
  name,
  size = "md",
}: {
  name: string;
  size?: "sm" | "md" | "lg";
}) {
  const initial = name.charAt(0);
  const gradient = gradients[hashName(name) % gradients.length];
  const sizeClass =
    size === "sm"
      ? "h-12 w-12 text-lg"
      : size === "lg"
        ? "h-20 w-20 text-3xl"
        : "h-14 w-14 text-xl";

  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br font-semibold text-white shadow-sm ${gradient} ${sizeClass}`}
      aria-hidden
    >
      {initial}
    </div>
  );
}
