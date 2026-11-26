export { default as Receipt, type ReceiptData } from "./Receipt";
export { default as ReceiptPreviewModal } from "./ReceiptPreviewModal";
export { default as KitchenTicket, type KitchenTicketData } from "./KitchenTicket";
export { printReceipt, printCustomerAndKitchen, getOrderTypeLabel, computeReceiptTotals } from "@/lib/receipt";
