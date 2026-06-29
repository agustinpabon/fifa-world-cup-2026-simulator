import React, { useEffect, useState } from "react";

interface AnimatedBarProps {
  value: number; // 0 to 100
  color?: string;
  className?: string;
}

export function AnimatedBar({ value, color = "bg-primary", className = "" }: AnimatedBarProps) {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    // Delay slightly to ensure transition is visible
    const timer = setTimeout(() => {
      setWidth(value);
    }, 100);
    return () => clearTimeout(timer);
  }, [value]);

  return (
    <div className={`h-2 bg-secondary overflow-hidden rounded-sm ${className}`}>
      <div
        className={`h-full ${color} transition-all duration-1000 ease-out`}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}
