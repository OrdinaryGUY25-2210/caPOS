import React, { useState } from 'react';

interface NavTooltipProps {
  content: string;
  children: React.ReactNode;
}

export function NavTooltip({ content, children }: NavTooltipProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative inline-block">
      <div onMouseEnter={() => setVisible(true)} onMouseLeave={() => setVisible(false)}>
        {children}
      </div>
      {visible && (
        <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 px-2 py-1 bg-gray-900 text-white text-xs rounded whitespace-nowrap">
          {content}
        </div>
      )}
    </div>
  );
}
