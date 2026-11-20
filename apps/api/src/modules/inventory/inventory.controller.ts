import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  BillFromReceiptInput, GoodsReceiptInput, InventoryItemInput, OpeningStockInput, PERMISSIONS, PO_STATUSES, PR_STATUSES, PurchaseOrderInput, PurchaseRequestInput, QuotationInput, StockCountInput, StockIssueInput, StoreInput,
  billFromReceiptSchema, fromQuotationSchema, goodsReceiptSchema, inventoryItemSchema, itemCategorySchema, openingStockSchema, purchaseOrderSchema, purchaseRequestSchema, quotationSchema, selectQuotationSchema, stockCountSchema, stockIssueSchema, storeSchema,
} from '@eduerp/shared';
import { Auth, Client, ClientInfo, RequireModule, RequirePermission, TenantMember } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { zod } from '../../common/zod.pipe';
import { InventoryService } from './inventory.service';
import { PurchaseService } from './purchase.service';

const M = 'INVENTORY';
const uuid = z.string().uuid();
const date = z.string().date();
const range = z.object({ from: date.optional(), to: date.optional(), campusId: uuid.optional() });

/** Inventory & purchase (Phase 17 / B6 §1). */
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inv: InventoryService, private readonly pur: PurchaseService) {}

  // ───── Set-up ─────
  @RequireModule(M) @TenantMember() @Get('options')
  options(@Auth() auth: AuthContext) { return this.inv.options(auth); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.INV_SETUP) @Get('expense-accounts')
  accounts(@Auth() auth: AuthContext) { return this.inv.expenseAccounts(auth); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.INV_SETUP) @Post('categories')
  addCategory(@Body(zod(itemCategorySchema)) b: { name: string; parentId?: string | null; isActive: boolean }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.inv.saveCategory(null, b, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.INV_SETUP) @Put('categories/:id')
  editCategory(@Param('id', ParseUUIDPipe) id: string, @Body(zod(itemCategorySchema)) b: { name: string; parentId?: string | null; isActive: boolean }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.inv.saveCategory(id, b, auth, c); }

  @RequireModule(M) @TenantMember() @Get('items')
  items(@Query(zod(z.object({ q: z.string().trim().max(80).optional(), categoryId: uuid.optional(), storeId: uuid.optional(), low: z.enum(['true', 'false']).optional() }))) x: { q?: string; categoryId?: string; storeId?: string; low?: string }, @Auth() auth: AuthContext) { return this.inv.items(auth, { ...x, low: x.low === 'true' }); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.INV_SETUP) @Post('items')
  addItem(@Body(zod(inventoryItemSchema)) b: InventoryItemInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.inv.saveItem(null, b, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.INV_SETUP) @Put('items/:id')
  editItem(@Param('id', ParseUUIDPipe) id: string, @Body(zod(inventoryItemSchema)) b: InventoryItemInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.inv.saveItem(id, b, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.INV_READ) @Get('items/:id/ledger')
  ledger(@Param('id', ParseUUIDPipe) id: string, @Query(zod(z.object({ storeId: uuid.optional() }))) x: { storeId?: string }, @Auth() auth: AuthContext) { return this.inv.ledger(id, auth, x.storeId); }

  @RequireModule(M) @TenantMember() @Get('stores')
  stores(@Auth() auth: AuthContext) { return this.inv.stores(auth); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.INV_SETUP) @Post('stores')
  addStore(@Body(zod(storeSchema)) b: StoreInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.inv.saveStore(null, b, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.INV_SETUP) @Put('stores/:id')
  editStore(@Param('id', ParseUUIDPipe) id: string, @Body(zod(storeSchema)) b: StoreInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.inv.saveStore(id, b, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.INV_SETUP) @Post('opening-stock')
  opening(@Body(zod(openingStockSchema)) b: OpeningStockInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.inv.opening(b, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.INV_READ) @Get('stock')
  stock(@Query(zod(z.object({ storeId: uuid.optional(), campusId: uuid.optional(), low: z.enum(['true', 'false']).optional() }))) x: { storeId?: string; campusId?: string; low?: string }, @Auth() auth: AuthContext) { return this.inv.stock(auth, { ...x, low: x.low === 'true' }); }

  // ───── Issues, transfers, counts ─────
  @RequireModule(M) @RequirePermission(PERMISSIONS.INV_ISSUE) @Post('issues')
  issue(@Body(zod(stockIssueSchema)) b: StockIssueInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.inv.issue(b, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.INV_READ) @Get('issues')
  issues(@Query(zod(range.extend({ type: z.enum(['ISSUE', 'TRANSFER']).optional() }))) x: { from?: string; to?: string; type?: string }, @Auth() auth: AuthContext) { return this.inv.issues(auth, x); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.INV_COUNT) @Post('counts')
  count(@Body(zod(stockCountSchema)) b: StockCountInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.inv.count(b, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.INV_READ) @Get('counts')
  counts(@Auth() auth: AuthContext) { return this.inv.counts(auth); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.INV_READ) @Get('reports/consumption')
  consumption(@Query(zod(range)) x: { from?: string; to?: string; campusId?: string }, @Auth() auth: AuthContext) { return this.inv.consumption(auth, x); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.INV_READ) @Get('reports/purchases')
  purchases(@Query(zod(range)) x: { from?: string; to?: string; campusId?: string }, @Auth() auth: AuthContext) { return this.pur.register(auth, x); }

  // ───── Purchase requests & quotations ─────
  @RequireModule(M) @RequirePermission(PERMISSIONS.INV_REQUEST) @Post('requests')
  addRequest(@Body(zod(purchaseRequestSchema)) b: PurchaseRequestInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.pur.createRequest(b, auth, c); }

  @RequireModule(M) @TenantMember() @Get('requests')
  requests(@Query(zod(z.object({ status: z.enum(PR_STATUSES).optional() }))) x: { status?: string }, @Auth() auth: AuthContext) { return this.pur.requests(auth, x.status); }

  @RequireModule(M) @TenantMember() @Get('requests/:id')
  request(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.pur.request(id, auth); }

  @RequireModule(M) @TenantMember() @Post('requests/:id/cancel') @HttpCode(200)
  cancelRequest(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.pur.cancelRequest(id, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.INV_PURCHASE) @Post('requests/:id/quotations')
  addQuotation(@Param('id', ParseUUIDPipe) id: string, @Body(zod(quotationSchema)) b: QuotationInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.pur.addQuotation(id, b, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.INV_PURCHASE) @Post('quotations/:id/select') @HttpCode(200)
  select(@Param('id', ParseUUIDPipe) id: string, @Body(zod(selectQuotationSchema)) b: { reason: string }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.pur.selectQuotation(id, b.reason, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.INV_PURCHASE) @Post('quotations/:id/order')
  fromQuotation(@Param('id', ParseUUIDPipe) id: string, @Body(zod(fromQuotationSchema)) b: { storeId: string; poDate: string; deliveryDate?: string | null; terms?: string | null }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.pur.orderFromQuotation(id, b, auth, c); }

  // ───── Orders, receipts, bills ─────
  @RequireModule(M) @RequirePermission(PERMISSIONS.INV_PURCHASE) @Post('orders')
  addOrder(@Body(zod(purchaseOrderSchema)) b: PurchaseOrderInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.pur.createOrder(b, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.INV_READ) @Get('orders')
  orders(@Query(zod(z.object({ status: z.enum(PO_STATUSES).optional() }))) x: { status?: string }, @Auth() auth: AuthContext) { return this.pur.orders(auth, x.status); }

  @RequireModule(M) @TenantMember() @Get('orders/:id')
  order(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.pur.order(id, auth); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.INV_PURCHASE) @Post('orders/:id/cancel') @HttpCode(200)
  cancelOrder(@Param('id', ParseUUIDPipe) id: string, @Body(zod(z.object({ reason: z.string().trim().min(3).max(300) }))) b: { reason: string }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.pur.cancelOrder(id, b.reason, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.INV_RECEIVE) @Post('orders/:id/receipts')
  receive(@Param('id', ParseUUIDPipe) id: string, @Body(zod(goodsReceiptSchema)) b: GoodsReceiptInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.pur.receive(id, b, auth, c); }

  @RequireModule(M) @TenantMember() @Post('receipts/:id/bill')
  bill(@Param('id', ParseUUIDPipe) id: string, @Body(zod(billFromReceiptSchema)) b: BillFromReceiptInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.pur.billFromReceipt(id, b, auth, c); }
}
