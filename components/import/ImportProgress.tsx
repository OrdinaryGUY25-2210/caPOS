import React from 'react';

interface ImportProgressProps {
  current: number;
  total: number;
}

export function ImportProgress({ current, total }: ImportProgressProps) {
  const percentage = (current / total) * 100;

  return (
    <div className="space-y-2">
      <div className="w-full bg-gray-200 rounded-full h-2">
        <div
          className="bg-blue-600 h-2 rounded-full transition-all"
          style={{ width: `${percentage}%` }}
        />
      </div>
      <p className="text-sm text-gray-600">
        {current} of {total} records imported
      </p>
    </div>
  );
}
