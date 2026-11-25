/**
 * PrinterSetup Component — Settings UI for Thermal Printer Configuration
 * Supports Bluetooth, USB, Network printers
 * Paper width, charset, cut behavior, default assignment
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { usePrinter } from '@/hooks/usePrinter';
import { PrinterConfig, ConnectionType, PaperWidth, Charset } from '@/lib/printer';
import { createClient } from '@/lib/supabase/client';

interface PrinterSetupProps {
  tenantId: string;
  onSaved?: () => void;
}

const CONNECTION_TYPES: { value: ConnectionType; label: string; description: string }[] = [
  { value: 'bluetooth', label: 'Bluetooth', description: 'Printer thermal Bluetooth (VSC, Epson, Star, Bixolon, dll)' },
  { value: 'usb', label: 'USB (WebUSB)', description: 'Printer USB terhubung langsung ke komputer/Tablet' },
  { value: 'network', label: 'Jaringan (LAN/WiFi)', description: 'Printer Ethernet/WiFi via print server' },
];

const PAPER_WIDTHS: { value: PaperWidth; label: string }[] = [
  { value: 58, label: '58 mm (2 inchi)' },
  { value: 80, label: '80 mm (3 inchi)' },
];

const CHARSETS: { value: Charset; label: string; description: string }[] = [
  { value: 'cp858', label: 'CP858 (Latin/Eropa)', description: 'Standar untuk karakter Latin, Indonesia, Eropa' },
  { value: 'gb18030', label: 'GB18030 (Cina/Extended)', description: 'Karakter Cina, Jepang, Korea, simbol extended' },
  { value: 'utf8', label: 'UTF-8 (Experimental)', description: 'Printer modern yang support UTF-8 native' },
];

export default function PrinterSetup({ tenantId, onSaved }: PrinterSetupProps) {
  const {
    state,
    connect,
    disconnect,
    printTest,
    requestBluetoothDevice,
    capabilities,
  } = usePrinter();

  const [printers, setPrinters] = useState<PrinterConfig[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Partial<PrinterConfig>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Load printers from database
  const loadPrinters = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('tenant_printers')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (!error && data) {
      setPrinters(data.map(mapDbToConfig));
    }
    setLoading(false);
  }, [tenantId]);

  useEffect(() => {
    loadPrinters();
  }, [loadPrinters]);

  // Map DB row to PrinterConfig
  function mapDbToConfig(row: any): PrinterConfig {
    return {
      id: row.id,
      name: row.name,
      connection: row.connection,
      bluetoothDeviceId: row.bluetooth_device_id,
      bluetoothServiceUuid: row.bluetooth_service_uuid,
      bluetoothCharUuid: row.bluetooth_char_uuid,
      usbVendorId: row.usb_vendor_id,
      usbProductId: row.usb_product_id,
      usbInterfaceNumber: row.usb_interface_number,
      usbEndpointOut: row.usb_endpoint_out,
      networkUrl: row.network_url,
      networkHeaders: row.network_headers,
      paperWidth: row.paper_width,
      charset: row.charset,
      cutAfterPrint: row.cut_after_print,
      isDefaultReceipt: row.is_default_receipt,
      isDefaultKitchen: row.is_default_kitchen,
    };
  }

  // Map PrinterConfig to DB row
  function mapConfigToDb(config: PrinterConfig) {
    return {
      id: config.id,
      tenant_id: tenantId,
      name: config.name,
      connection: config.connection,
      bluetooth_device_id: config.bluetoothDeviceId,
      bluetooth_service_uuid: config.bluetoothServiceUuid,
      bluetooth_char_uuid: config.bluetoothCharUuid,
      usb_vendor_id: config.usbVendorId,
      usb_product_id: config.usbProductId,
      usb_interface_number: config.usbInterfaceNumber,
      usb_endpoint_out: config.usbEndpointOut,
      network_url: config.networkUrl,
      network_headers: config.networkHeaders,
      paper_width: config.paperWidth,
      charset: config.charset,
      cut_after_print: config.cutAfterPrint,
      is_default_receipt: config.isDefaultReceipt,
      is_default_kitchen: config.isDefaultKitchen,
      updated_at: new Date().toISOString(),
    };
  }

  // Save printer to database
  const handleSave = async (config: PrinterConfig) => {
    const supabase = createClient();
    const dbData = mapConfigToDb(config);

    const { error } = config.id.startsWith('new-')
      ? await supabase.from('tenant_printers').insert(dbData)
      : await supabase.from('tenant_printers').upsert(dbData);

    if (error) {
      setMessage({ type: 'error', text: `Gagal menyimpan: ${error.message}` });
      return false;
    }

    setMessage({ type: 'success', text: 'Printer berhasil disimpan' });
    await loadPrinters();
    setEditingId(null);
    onSaved?.();
    return true;
  };

  // Delete printer
  const handleDelete = async (id: string) => {
    if (!confirm('Hapus printer ini?')) return;
    const supabase = createClient();
    const { error } = await supabase.from('tenant_printers').delete().eq('id', id);
    if (!error) {
      await loadPrinters();
      setMessage({ type: 'success', text: 'Printer dihapus' });
    }
  };

  // Start editing new or existing
  const startEdit = (printer?: PrinterConfig) => {
    if (printer) {
      setEditingId(printer.id);
      setFormData({ ...printer });
    } else {
      const newId = `new-${Date.now()}`;
      setEditingId(newId);
      setFormData({
        id: newId,
        name: '',
        connection: 'bluetooth',
        paperWidth: 58,
        charset: 'cp858',
        cutAfterPrint: true,
        isDefaultReceipt: false,
        isDefaultKitchen: false,
      });
    }
  };

  // Cancel edit
  const cancelEdit = () => {
    setEditingId(null);
    setFormData({});
  };

  // Handle form input change
  const handleChange = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));

    // If connection type changed, clear connection-specific fields
    if (field === 'connection') {
      setFormData(prev => {
        const next = { ...prev, connection: value };
        if (value !== 'bluetooth') {
          next.bluetoothDeviceId = undefined;
          next.bluetoothServiceUuid = undefined;
          next.bluetoothCharUuid = undefined;
        }
        if (value !== 'usb') {
          next.usbVendorId = undefined;
          next.usbProductId = undefined;
          next.usbInterfaceNumber = undefined;
          next.usbEndpointOut = undefined;
        }
        if (value !== 'network') {
          next.networkUrl = undefined;
          next.networkHeaders = undefined;
        }
        return next;
      });
    }
  };

  // Pick Bluetooth device
  const handlePickBluetooth = async () => {
    const result = await requestBluetoothDevice();
    if (result) {
      handleChange('bluetoothDeviceId', result.deviceId);
      handleChange('name', result.name || formData.name);
      setMessage({ type: 'success', text: `Perangkat dipilih: ${result.name}` });
    }
  };

  // Test connection & print
  const handleTest = async (config: PrinterConfig) => {
    setTesting(config.id);
    const connected = await connect(config);
    if (connected) {
      const ok = await printTest(config);
      if (ok) setMessage({ type: 'success', text: 'Test print berhasil' });
      else setMessage({ type: 'error', text: 'Test print gagal' });
    } else {
      setMessage({ type: 'error', text: 'Koneksi gagal' });
    }
    setTesting(null);
  };

  // Render connection-specific fields
  const renderConnectionFields = () => {
    const conn = formData.connection;
    if (!conn) return null;

    switch (conn) {
      case 'bluetooth':
        return (
          <div className="space-y-3 border-t pt-3">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handlePickBluetooth}
                disabled={!capabilities.bluetooth || connecting === formData.id}
                className="btn btn-secondary"
              >
                {formData.bluetoothDeviceId ? 'Ganti Perangkat' : 'Pilih Perangkat Bluetooth'}
              </button>
              {!capabilities.bluetooth && (
                <span className="text-sm text-muted-foreground">Web Bluetooth tidak didukung browser ini</span>
              )}
            </div>
            {formData.bluetoothDeviceId && (
              <p className="text-sm text-muted-foreground">
                Perangkat terpilih: <code>{formData.bluetoothDeviceId}</code>
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Service UUID</label>
                <input
                  type="text"
                  value={formData.bluetoothServiceUuid || ''}
                  onChange={e => handleChange('bluetoothServiceUuid', e.target.value)}
                  placeholder="000018f0-0000-1000-8000-00805f9b34fb"
                  className="input input-sm"
                />
              </div>
              <div>
                <label className="label">Characteristic UUID</label>
                <input
                  type="text"
                  value={formData.bluetoothCharUuid || ''}
                  onChange={e => handleChange('bluetoothCharUuid', e.target.value)}
                  placeholder="00002af1-0000-1000-8000-00805f9b34fb"
                  className="input input-sm"
                />
              </div>
            </div>
          </div>
        );

      case 'usb':
        return (
          <div className="space-y-3 border-t pt-3">
            <p className="text-sm text-muted-foreground">
              Klik "Test Print" untuk memilih perangkat USB via browser dialog.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Vendor ID</label>
                <input
                  type="number"
                  value={formData.usbVendorId || ''}
                  onChange={e => handleChange('usbVendorId', parseInt(e.target.value) || undefined)}
                  placeholder="Contoh: 1208 (Epson), 04b8 (Star)"
                  className="input input-sm"
                />
              </div>
              <div>
                <label className="label">Product ID</label>
                <input
                  type="number"
                  value={formData.usbProductId || ''}
                  onChange={e => handleChange('usbProductId', parseInt(e.target.value) || undefined)}
                  placeholder="Contoh: 0x0001"
                  className="input input-sm"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Interface Number</label>
                <input
                  type="number"
                  value={formData.usbInterfaceNumber || 0}
                  onChange={e => handleChange('usbInterfaceNumber', parseInt(e.target.value) || 0)}
                  className="input input-sm"
                />
              </div>
              <div>
                <label className="label">Endpoint Out</label>
                <input
                  type="number"
                  value={formData.usbEndpointOut || 1}
                  onChange={e => handleChange('usbEndpointOut', parseInt(e.target.value) || 1)}
                  className="input input-sm"
                />
              </div>
            </div>
          </div>
        );

      case 'network':
        return (
          <div className="space-y-3 border-t pt-3">
            <div>
              <label className="label">Print Server URL</label>
              <input
                type="url"
                value={formData.networkUrl || ''}
                onChange={e => handleChange('networkUrl', e.target.value)}
                placeholder="http://192.168.1.100:9100/print"
                className="input input-sm"
              />
              <p className="text-sm text-muted-foreground">
                Endpoint yang menerima POST raw bytes (ESC/POS). Contoh: rawtcp, Node.js print server, dll.
              </p>
            </div>
            <div>
              <label className="label">Headers (JSON)</label>
              <textarea
                value={JSON.stringify(formData.networkHeaders || {}, null, 2)}
                onChange={e => {
                  try {
                    handleChange('networkHeaders', JSON.parse(e.target.value));
                  } catch {}
                }}
                rows={3}
                className="input input-sm font-mono text-xs"
                placeholder='{ "Authorization": "Bearer token" }'
              />
            </div>
          </div>
        );
    }
  };

  // Render printer card
  const renderPrinterCard = (printer: PrinterConfig) => (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-medium">{printer.name}</h3>
            <span className="badge badge-outline">{printer.connection.toUpperCase()}</span>
            {printer.isDefaultReceipt && <span className="badge badge-primary">Struk</span>}
            {printer.isDefaultKitchen && <span className="badge badge-secondary">Dapur</span>}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {printer.paperWidth}mm · {printer.charset.toUpperCase()} · {printer.cutAfterPrint ? 'Auto-cut' : 'Manual cut'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleTest(printer)}
            disabled={testing === printer.id || state.isPrinting}
            className="btn btn-sm btn-outline"
          >
            {testing === printer.id ? 'Testing...' : 'Test Print'}
          </button>
          <button onClick={() => startEdit(printer)} className="btn btn-sm btn-outline">Edit</button>
          <button onClick={() => handleDelete(printer.id)} className="btn btn-sm btn-outline text-red-600">Hapus</button>
        </div>
      </div>
    </div>
  );

  // Render edit form
  const renderEditForm = () => {
    if (!editingId) return null;

    return (
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium">
            {formData.id.startsWith('new-') ? 'Tambah Printer Baru' : `Edit: ${formData.name}`}
          </h3>
          <button onClick={cancelEdit} className="btn btn-ghost btn-sm">Batal</button>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Nama Printer</label>
              <input
                type="text"
                value={formData.name || ''}
                onChange={e => handleChange('name', e.target.value)}
                placeholder="Contoh: VSC Bluetooth, Epson TM-T20"
                className="input"
                required
              />
            </div>
            <div>
              <label className="label">Tipe Koneksi</label>
              <select
                value={formData.connection}
                onChange={e => handleChange('connection', e.target.value as ConnectionType)}
                className="input"
              >
                {CONNECTION_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="label">Ukuran Kertas</label>
            <select
              value={formData.paperWidth}
              onChange={e => handleChange('paperWidth', parseInt(e.target.value) as PaperWidth)}
              className="input"
            >
              {PAPER_WIDTHS.map(p => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">Encoding (Charset)</label>
            <select
              value={formData.charset}
              onChange={e => handleChange('charset', e.target.value as Charset)}
              className="input"
            >
              {CHARSETS.map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>

          {renderConnectionFields()}

          <div className="flex items-center gap-4 border-t pt-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.cutAfterPrint}
                onChange={e => handleChange('cutAfterPrint', e.target.checked)}
                className="checkbox"
              />
              Potong kertas otomatis setelah cetak
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.isDefaultReceipt}
                onChange={e => handleChange('isDefaultReceipt', e.target.checked)}
                className="checkbox"
              />
              Default untuk Struk Pelanggan
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.isDefaultKitchen}
                onChange={e => handleChange('isDefaultKitchen', e.target.checked)}
                className="checkbox"
              />
              Default untuk Tiket Dapur
            </label>
          </div>

          <div className="flex justify-end gap-3 border-t pt-4">
            <button onClick={cancelEdit} className="btn btn-outline">Batal</button>
            <button
              onClick={() => {
                const config = { ...formData, id: formData.id.startsWith('new-') ? crypto.randomUUID() : formData.id } as PrinterConfig;
                handleSave(config);
              }}
              className="btn btn-primary"
            >
              Simpan
            </button>
          </div>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Pengaturan Printer Thermal</h2>
          <p className="text-sm text-muted-foreground">
            Konfigurasi printer untuk struk pelanggan & tiket dapur. Satu printer bisa digunakan untuk keduanya.
          </p>
        </div>
        <button onClick={() => startEdit()} className="btn btn-primary">
          + Tambah Printer
        </button>
      </div>

      {/* Message */}
      {message && (
        <div className={`alert ${message.type === 'success' ? 'alert-success' : 'alert-error'}`}>
          {message.text}
        </div>
      )}

      {/* Edit Form */}
      {renderEditForm()}

      {/* Printer List */}
      <div className="space-y-3">
        {printers.length === 0 ? (
          <div className="card p-8 text-center text-muted-foreground">
            <p className="mb-2">Belum ada printer terkonfigurasi</p>
            <p className="text-sm">Klik "Tambah Printer" untuk memulai</p>
          </div>
        ) : (
          printers.map(renderPrinterCard)
        )}
      </div>

      {/* Capabilities Info */}
      <details className="card p-4 text-sm text-muted-foreground">
        <summary className="cursor-pointer font-medium mb-2">Informasi Kemampuan Browser</summary>
        <ul className="list-disc list-inside space-y-1">
          <li>Web Bluetooth: {capabilities.bluetooth ? '✅ Tersedia' : '❌ Tidak didukung'}</li>
          <li>WebUSB: {capabilities.usb ? '✅ Tersedia' : '❌ Tidak didukung'}</li>
          <li>Network Print: ✅ Selalu tersedia (fetch)</li>
        </ul>
        <p className="mt-2">
          <strong>Catatan:</strong> iOS Safari tidak mendukung Web Bluetooth. Gunakan USB OTG atau Network Print untuk iPad/iPhone.
        </p>
      </details>
    </div>
  );
}