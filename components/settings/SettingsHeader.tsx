import React from 'react';

interface SettingsHeaderProps {
  title: string;
  description?: string;
}

export function SettingsHeader({ title, description }: SettingsHeaderProps) {
  return (
    <div className="mb-6">
      <h1 className="text-3xl font-bold text-gray-900">{title}</h1>
      {description && <p className="text-gray-600 mt-1">{description}</p>}
    </div>
  );
}
