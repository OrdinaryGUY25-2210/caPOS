"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

/**
 * Input password dengan tombol mata (👁️) yang SELALU terlihat di ujung
 * kanan field — bukan cuma muncul saat hover/focus — supaya user (terutama
 * di HP, di mana tidak ada konsep "hover") selalu tahu ada opsi untuk
 * menampilkan password sebelum submit.
 */
export default function PasswordInput({
  value,
  onChange,
  placeholder,
  minLength,
  required,
  autoComplete,
  className = "input-field",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minLength?: number;
  required?: boolean;
  autoComplete?: string;
  className?: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        type={visible ? "text" : "password"}
        required={required}
        minLength={minLength}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className={`${className} pr-11`}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Sembunyikan password" : "Tampilkan password"}
        aria-pressed={visible}
        tabIndex={-1}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-700 transition-colors"
      >
        {visible ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
}
