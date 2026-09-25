'use client';

import { useState } from 'react';
import * as XLSX from 'xlsx';
import { SettingsHeader } from '@/components/settings/SettingsHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import {
  FileUploader,
  ImportTypeSelector,
  ColumnMapper,
  ImportPreview,
  ImportProgress,
  ImportResult,
} from '@/components/import';
import { getCurrentProfile } from '@/lib/getCurrentProfile';
import { createClient } from '@/lib/supabase/client';

type ImportType = 'products' | 'customers' | 'suppliers' | 'recipes';
type Step = 'type' | 'upload' | 'map' | 'preview' | 'importing' | 'result';

interface FieldConfig {
  value: string;
  label: string;
  required?: boolean;
}

// PRIORITY 14: real target columns for each entity, taken straight from
// the actual schema (supabase/migration_014_capos_phase3_business_omnichannel.sql
// for customers/suppliers, supabase/schema.sql + migration_009 for products)
// — not a guess.
const FIELD_CONFIGS: Record<Exclude<ImportType, 'recipes'>, FieldConfig[]> = {
  products: [
    { value: 'name', label: 'Nama Produk', required: true },
    { value: 'price', label: 'Harga Jual', required: true },
    { value: 'category', label: 'Kategori' },
    { value: 'cost_price', label: 'HPP (Harga Pokok)' },
  ],
  customers: [
    { value: 'customer_name', label: 'Nama Pelanggan', required: true },
    { value: 'customer_code', label: 'Kode Pelanggan (kosongkan untuk auto)' },
    { value: 'phone_number', label: 'No. Telepon' },
    { value: 'email', label: 'Email' },
    { value: 'address', label: 'Alamat' },
    { value: 'city', label: 'Kota' },
    { value: 'province', label: 'Provinsi' },
  ],
  suppliers: [
    { value: 'company_name', label: 'Nama Perusahaan', required: true },
    { value: 'supplier_code', label: 'Kode Supplier (kosongkan untuk auto)' },
    { value: 'contact_person', label: 'Kontak Person' },
    { value: 'phone_number', label: 'No. Telepon' },
    { value: 'email', label: 'Email' },
    { value: 'address', label: 'Alamat' },
    { value: 'city', label: 'Kota' },
    { value: 'province', label: 'Provinsi' },
  ],
};

const TABLE_NAME: Record<Exclude<ImportType, 'recipes'>, string> = {
  products: 'products',
  customers: 'customers',
  suppliers: 'suppliers',
};

function normalize(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** IDR harga biasanya tanpa desimal — "15.000", "15,000", "15000" semua
 *  dianggap 15000. Kalau formatnya bukan angka sama sekali, return null
 *  supaya baris itu bisa ditandai gagal validasi dengan jelas. */
function parseIdrNumber(raw: string): number | null {
  if (raw === undefined || raw === null) return null;
  const cleaned = String(raw).replace(/rp/gi, '').replace(/[.,\s]/g, '').trim();
  if (cleaned === '' || !/^\d+$/.test(cleaned)) return null;
  return parseInt(cleaned, 10);
}

interface RowError { row: number; message: string }

export default function ImportPage() {
  const [importType, setImportType] = useState<ImportType>('products');
  const [step, setStep] = useState<Step>('type');

  const [file, setFile] = useState<File | null>(null);
  const [parseError, setParseError] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([]);
  const [mappings, setMappings] = useState<Record<string, string>>({});

  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [result, setResult] = useState<{ successful: number; failed: number; errors: RowError[] } | null>(null);
  const [importing, setImporting] = useState(false);

  const fieldConfig = importType === 'recipes' ? [] : FIELD_CONFIGS[importType];

  async function handleFileSelect(f: File) {
    setFile(f);
    setParseError('');
    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false }) as Record<string, string>[];
      if (rows.length === 0) {
        setParseError('File tidak berisi baris data (atau cuma ada header).');
        return;
      }
      const cols = Object.keys(rows[0]);
      setHeaders(cols);
      setRawRows(rows);

      // Auto-map kolom yang namanya mirip nama field target, supaya
      // pengguna tidak perlu set manual satu-satu kalau header CSV-nya
      // sudah jelas (mis. "Nama Produk" -> name, "customer_name" -> customer_name).
      const autoMap: Record<string, string> = {};
      for (const col of cols) {
        const normCol = normalize(col);
        const match = fieldConfig.find((f2) => normalize(f2.label) === normCol || normalize(f2.value) === normCol);
        if (match) autoMap[col] = match.value;
      }
      setMappings(autoMap);
      setStep('map');
    } catch {
      setParseError('Gagal membaca file. Pastikan formatnya .csv, .xlsx, atau .xls.');
    }
  }

  function mappedRows(): Record<string, string>[] {
    return rawRows.map((row) => {
      const mapped: Record<string, string> = {};
      for (const [col, field] of Object.entries(mappings)) {
        if (field) mapped[field] = row[col] ?? '';
      }
      return mapped;
    });
  }

  const missingRequired = fieldConfig
    .filter((f) => f.required)
    .filter((f) => !Object.values(mappings).includes(f.value));

  async function runImport() {
    setStep('importing');
    setImporting(true);

    const { profile } = await getCurrentProfile();
    if (!profile) {
      setResult({ successful: 0, failed: rawRows.length, errors: [{ row: 0, message: 'Sesi login tidak valid — muat ulang halaman dan coba lagi.' }] });
      setImporting(false);
      setStep('result');
      return;
    }

    const supabase = createClient();
    const rows = mappedRows();
    setProgress({ current: 0, total: rows.length });

    // Ambil kode yang sudah ada dulu supaya duplikat bisa dideteksi SEBELUM
    // insert (bukan cuma menabrak unique constraint di tengah proses) —
    // untuk products tidak perlu karena products tidak punya kolom kode unik.
    const codeField = importType === 'customers' ? 'customer_code' : importType === 'suppliers' ? 'supplier_code' : null;
    const existingCodes = new Set<string>();
    if (codeField) {
      const { data: existing } = await supabase
        .from(TABLE_NAME[importType as 'customers' | 'suppliers'])
        .select(codeField)
        .eq('tenant_id', profile.tenant_id);
      (existing ?? []).forEach((r: any) => { if (r[codeField]) existingCodes.add(r[codeField]); });
    }
    const seenCodesThisBatch = new Set<string>();

    const errors: RowError[] = [];
    let successful = 0;

    for (let i = 0; i < rows.length; i++) {
      const rowNum = i + 2; // +2: baris 1 = header, data mulai baris 2
      const row = rows[i];
      setProgress({ current: i + 1, total: rows.length });

      try {
        if (importType === 'products') {
          const name = (row.name ?? '').trim();
          if (!name) throw new Error(`Kolom "${labelFor('name')}": kosong. → Perbaiki: isi nama produk.`);
          const price = parseIdrNumber(row.price);
          if (price === null || price < 0) {
            throw new Error(`Kolom "${labelFor('price')}": "${row.price}" bukan angka valid. → Perbaiki: isi angka saja, mis. 15000 atau 15.000.`);
          }
          let costPrice: number | null = null;
          if (row.cost_price) {
            costPrice = parseIdrNumber(row.cost_price);
            if (costPrice === null) {
              throw new Error(`Kolom "${labelFor('cost_price')}": "${row.cost_price}" bukan angka valid. → Perbaiki: isi angka saja atau kosongkan.`);
            }
          }
          const { error } = await supabase.from('products').insert({
            tenant_id: profile.tenant_id,
            name,
            price,
            category: row.category?.trim() || null,
            cost_price: costPrice ?? 0,
          });
          if (error) throw new Error(`Database menolak baris ini: ${error.message}`);
        } else if (importType === 'customers' || importType === 'suppliers') {
          const isCustomer = importType === 'customers';
          const nameField = isCustomer ? 'customer_name' : 'company_name';
          const name = (row[nameField] ?? '').trim();
          if (!name) throw new Error(`Kolom "${labelFor(nameField)}": kosong. → Perbaiki: isi ${isCustomer ? 'nama pelanggan' : 'nama perusahaan'}.`);

          let code = (row[codeField!] ?? '').trim();
          if (!code) {
            code = `${isCustomer ? 'CUST' : 'SUP'}-${Date.now().toString(36).toUpperCase()}${i}`;
          }
          if (existingCodes.has(code) || seenCodesThisBatch.has(code)) {
            throw new Error(`Kolom "${labelFor(codeField!)}": "${code}" sudah dipakai. → Perbaiki: pakai kode lain atau kosongkan kolomnya supaya dibuat otomatis.`);
          }
          seenCodesThisBatch.add(code);

          const payload: Record<string, unknown> = {
            tenant_id: profile.tenant_id,
            phone_number: row.phone_number?.trim() || null,
            email: row.email?.trim() || null,
            address: row.address?.trim() || null,
            city: row.city?.trim() || null,
            province: row.province?.trim() || null,
          };
          if (isCustomer) {
            payload.customer_name = name;
            payload.customer_code = code;
          } else {
            payload.company_name = name;
            payload.supplier_code = code;
            payload.contact_person = row.contact_person?.trim() || null;
          }

          const { error } = await supabase.from(TABLE_NAME[importType]).insert(payload);
          if (error) throw new Error(`Database menolak baris ini: ${error.message}`);
        }
        successful++;
      } catch (e) {
        errors.push({ row: rowNum, message: e instanceof Error ? e.message : 'Gagal menyimpan baris ini.' });
      }
    }

    setResult({ successful, failed: errors.length, errors });
    setImporting(false);
    setStep('result');
  }

  function labelFor(value: string) {
    return fieldConfig.find((f) => f.value === value)?.label ?? value;
  }

  function reset() {
    setFile(null);
    setParseError('');
    setHeaders([]);
    setRawRows([]);
    setMappings({});
    setResult(null);
    setProgress({ current: 0, total: 0 });
    setStep('type');
  }

  return (
    <div className="space-y-6">
      <SettingsHeader backHref="/dashboard/settings" title="Import Data" description="Impor data dari file CSV atau Excel" />

      <Card className="p-6 space-y-4">
        {step === 'type' && (
          <div className="space-y-4">
            <ImportTypeSelector selected={importType} onChange={setImportType} />
            {importType === 'recipes' ? (
              <Alert
                variant="warning"
                title="Belum didukung"
                message='Import "Recipes" belum tersedia — resep butuh relasi produk + daftar bahan baku bertingkat yang tidak bisa dipetakan dari satu file datar. Tambahkan resep secara manual di halaman Resep.'
              />
            ) : (
              <div className="flex justify-end">
                <Button variant="primary" onClick={() => setStep('upload')}>
                  Lanjutkan
                </Button>
              </div>
            )}
          </div>
        )}

        {step === 'upload' && (
          <div className="space-y-4">
            <FileUploader onFileSelect={handleFileSelect} />
            {parseError && <Alert variant="error" message={parseError} />}
            <div className="flex justify-start">
              <Button variant="outline" onClick={() => setStep('type')}>
                Kembali
              </Button>
            </div>
          </div>
        )}

        {step === 'map' && (
          <div className="space-y-4">
            <ColumnMapper columns={headers} mappings={mappings} onMappingChange={(col, val) => setMappings((m) => ({ ...m, [col]: val }))} targetFields={fieldConfig} />
            {missingRequired.length > 0 && (
              <Alert
                variant="warning"
                message={`Kolom wajib belum dipetakan: ${missingRequired.map((f) => f.label).join(', ')}.`}
              />
            )}
            <div className="flex justify-between gap-3">
              <Button variant="outline" onClick={() => setStep('upload')}>
                Kembali
              </Button>
              <Button variant="primary" disabled={missingRequired.length > 0} onClick={() => setStep('preview')}>
                Lihat Pratinjau
              </Button>
            </div>
          </div>
        )}

        {step === 'preview' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Menampilkan 5 dari {rawRows.length} baris (setelah dipetakan ke kolom {importType}).
            </p>
            <ImportPreview headers={fieldConfig.map((f) => f.label)} rows={mappedRows().map((r) => {
              const out: Record<string, string> = {};
              fieldConfig.forEach((f) => { out[f.label] = r[f.value] ?? ''; });
              return out;
            })} />
            <div className="flex justify-between gap-3">
              <Button variant="outline" onClick={() => setStep('map')}>
                Kembali
              </Button>
              <Button variant="primary" onClick={runImport}>
                Mulai Impor {rawRows.length} Baris
              </Button>
            </div>
          </div>
        )}

        {step === 'importing' && (
          <div className="space-y-4">
            <ImportProgress current={progress.current} total={progress.total} />
            <p className="text-xs text-gray-400 text-center">Jangan tutup halaman ini sampai selesai.</p>
          </div>
        )}

        {step === 'result' && result && (
          <div className="space-y-4">
            <ImportResult successful={result.successful} failed={result.failed} errors={result.errors} />
            <div className="flex justify-end">
              <Button variant="primary" onClick={reset}>
                Impor File Lain
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
