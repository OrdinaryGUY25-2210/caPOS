import React, { useRef } from 'react';
import { Upload } from 'lucide-react';

interface FileUploaderProps {
  accept?: string;
  onFileSelect: (file: File) => void;
}

export function FileUploader({ accept = '.csv,.xlsx,.xls', onFileSelect }: FileUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-500 cursor-pointer"
      onClick={() => fileInputRef.current?.click()}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files?.[0];
        if (f) onFileSelect(f);
      }}
    >
      <Upload className="mx-auto mb-2 text-gray-400" size={32} />
      <p className="text-gray-900 font-medium">Drag and drop your file here</p>
      <p className="text-gray-600 text-sm">or click to select</p>
      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        onChange={(e) => e.target.files?.[0] && onFileSelect(e.target.files[0])}
        className="hidden"
      />
    </div>
  );
}
