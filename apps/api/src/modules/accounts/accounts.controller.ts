import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes } from '@nestjs/swagger';
import { z } from 'zod';
import {
  AccountInput, AccountsReportQuery, BankAccountInput, BillInput, ContraInput, CostCentreInput, ExpenseVoucherInput, JournalVoucherInput, OpeningBalancesInput,
  PERMISSIONS, REPORTS, ReportCode, StatementMapping, TaxCodeInput, TdsSectionInput, VendorInput, VendorPaymentInput,
  accountSchema, accountUpdateSchema, accountsReportQuerySchema, bankAccountSchema, billSchema, cancelSchema, contraSchema, costCentreSchema, expenseVoucherSchema,
  ignoreLineSchema, journalVoucherSchema, matchSchema, money, openingBalancesSchema, periodLockSchema, periodUnlockSchema, postLineSchema, statementMappingSchema,
  taxCodeSchema, tdsSectionSchema, vendorPaymentSchema, vendorSchema, yearCloseSchema,
} from '@eduerp/shared';
import { Auth, Client, ClientInfo, RequireModule, RequirePermission } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { zod } from '../../common/zod.pipe';
import { AppError } from '../../common/problem';
import { AccountsSetupService } from './setup.service';
import { VendorsService } from './vendors.service';
import { AccountPaymentsService } from './payments.service';
import { BankReconService } from './bank.service';
import { AccountsReportsService } from './reports.service';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const uuid = z.string().uuid();
type Cancel = { reason: string; date?: string };
type Blob = { buffer: Buffer; originalname: string; size: number };
const M = 'ACCOUNTS';

/** Accounts (Phase 13 / B4 §1): set-up, vendors & bills, payments & vouchers, bank reconciliation, reports. */
@Controller('accounts')
export class AccountsController {
  constructor(
    private readonly setup: AccountsSetupService,
    private readonly vendors: VendorsService,
    private readonly pay: AccountPaymentsService,
    private readonly bank: BankReconService,
    private readonly reports: AccountsReportsService,
  ) {}

  // ───── Set-up ─────
  @RequireModule(M) @RequirePermission(PERMISSIONS.ACC_READ) @Get('chart')
  chart(@Query(zod(z.object({ asOn: z.string().date().optional() }))) q: { asOn?: string }, @Auth() auth: AuthContext) { return this.setup.chart(auth, q.asOn); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.ACC_SETUP) @Post('chart')
  addAccount(@Body(zod(accountSchema)) b: AccountInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.setup.addAccount(b, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.ACC_SETUP) @Put('chart/:id')
  editAccount(@Param('id', ParseUUIDPipe) id: string, @Body(zod(accountUpdateSchema)) b: { name: string; isActive: boolean }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.setup.updateAccount(id, b, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.ACC_READ) @Get('cost-centres')
  costCentres(@Auth() auth: AuthContext) { return this.setup.costCentres(auth); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.ACC_SETUP) @Post('cost-centres')
  addCostCentre(@Body(zod(costCentreSchema)) b: CostCentreInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.setup.saveCostCentre(null, b, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.ACC_SETUP) @Put('cost-centres/:id')
  editCostCentre(@Param('id', ParseUUIDPipe) id: string, @Body(zod(costCentreSchema)) b: CostCentreInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.setup.saveCostCentre(id, b, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.ACC_READ) @Get('bank-accounts')
  bankAccounts(@Auth() auth: AuthContext) { return this.setup.bankAccounts(auth); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.ACC_SETUP) @Post('bank-accounts')
  addBank(@Body(zod(bankAccountSchema)) b: BankAccountInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.setup.addBankAccount(b, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.ACC_SETUP) @Put('bank-accounts/:id')
  editBank(@Param('id', ParseUUIDPipe) id: string, @Body(zod(z.object({ bankName: z.string().trim().min(2).max(100), branch: z.string().trim().max(100).optional().nullable(), isFeeCollection: z.boolean(), isActive: z.boolean() }))) b: { bankName: string; branch?: string | null; isFeeCollection: boolean; isActive: boolean }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.setup.updateBankAccount(id, b, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.ACC_REVEAL) @Post('bank-accounts/:id/reveal') @HttpCode(200)
  revealBank(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.setup.revealBankAccount(id, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.ACC_READ) @Get('statutory')
  statutory(@Auth() auth: AuthContext) { return this.setup.statutory(auth); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.ACC_SETUP) @Post('statutory/confirm') @HttpCode(200)
  confirmRates(@Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.setup.confirmRates(auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.ACC_SETUP) @Post('tax-codes')
  addTax(@Body(zod(taxCodeSchema)) b: TaxCodeInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.setup.saveTaxCode(null, b, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.ACC_SETUP) @Put('tax-codes/:id')
  editTax(@Param('id', ParseUUIDPipe) id: string, @Body(zod(taxCodeSchema)) b: TaxCodeInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.setup.saveTaxCode(id, b, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.ACC_SETUP) @Post('tds-sections')
  addTds(@Body(zod(tdsSectionSchema)) b: TdsSectionInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.setup.saveTdsSection(null, b, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.ACC_SETUP) @Put('tds-sections/:id')
  editTds(@Param('id', ParseUUIDPipe) id: string, @Body(zod(tdsSectionSchema)) b: TdsSectionInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.setup.saveTdsSection(id, b, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.ACC_SETUP) @Post('opening-balances')
  opening(@Body(zod(openingBalancesSchema)) b: OpeningBalancesInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.setup.openingBalances(b, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.ACC_READ) @Get('periods')
  periods(@Auth() auth: AuthContext) { return this.setup.periods(auth); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.ACC_CLOSE) @Post('periods/lock') @HttpCode(200)
  lock(@Body(zod(periodLockSchema)) b: { month: string }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.setup.lockMonth(b.month, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.ACC_CLOSE) @Post('periods/unlock') @HttpCode(200)
  unlock(@Body(zod(periodUnlockSchema)) b: { month: string; reason: string }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.setup.requestUnlock(b.month, b.reason, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.ACC_CLOSE) @Post('years/close') @HttpCode(200)
  closeYear(@Body(zod(yearCloseSchema)) b: { financialYearId: string }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.setup.closeYear(b.financialYearId, auth, c); }

  // ───── Vendors & bills ─────
  @RequireModule(M) @RequirePermission(PERMISSIONS.ACC_READ) @Get('vendors')
  vendorList(@Query(zod(z.object({ q: z.string().trim().max(60).optional() }))) q: { q?: string }, @Auth() auth: AuthContext) { return this.vendors.vendors(auth, q.q); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.ACC_ENTRY) @Post('vendors')
  addVendor(@Body(zod(vendorSchema)) b: VendorInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.vendors.saveVendor(null, b, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.ACC_ENTRY) @Put('vendors/:id')
  editVendor(@Param('id', ParseUUIDPipe) id: string, @Body(zod(vendorSchema)) b: VendorInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.vendors.saveVendor(id, b, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.ACC_REVEAL) @Post('vendors/:id/reveal') @HttpCode(200)
  revealVendor(@Param('id', ParseUUIDPipe) id: string, @Body(zod(z.object({ field: z.enum(['pan', 'bankAccountNo']) }))) b: { field: 'pan' | 'bankAccountNo' }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.vendors.revealVendor(id, b.field, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.ACC_READ) @Get('vendors/:id/ledger')
  vendorLedger(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.vendors.vendorLedger(id, auth); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.ACC_READ) @Get('ageing')
  ageing(@Auth() auth: AuthContext) { return this.vendors.ageing(auth); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.ACC_READ) @Get('bills')
  bills(@Query(zod(z.object({ vendorId: uuid.optional(), status: z.string().max(20).optional() }))) q: { vendorId?: string; status?: string }, @Auth() auth: AuthContext) { return this.vendors.bills(auth, q); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.ACC_ENTRY) @Post('bills/preview') @HttpCode(200)
  preview(@Body(zod(billSchema)) b: BillInput, @Auth() auth: AuthContext) { return this.vendors.preview(b, auth); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.ACC_ENTRY) @Post('bills')
  addBill(@Body(zod(billSchema)) b: BillInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.vendors.createBill(b, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.ACC_READ) @Get('bills/:id')
  bill(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.vendors.bill(id, auth); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.ACC_ENTRY) @Post('bills/:id/cancel') @HttpCode(200)
  cancelBill(@Param('id', ParseUUIDPipe) id: string, @Body(zod(cancelSchema)) b: Cancel, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.vendors.cancelBill(id, b.reason, b.date, auth, c); }

  // ───── Payments & vouchers ─────
  @RequireModule(M) @RequirePermission(PERMISSIONS.ACC_READ) @Get('payments')
  payments(@Query(zod(z.object({ vendorId: uuid.optional() }))) q: { vendorId?: string }, @Auth() auth: AuthContext) { return this.pay.payments(auth, q); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.ACC_ENTRY) @Post('payments')
  addPayment(@Body(zod(vendorPaymentSchema)) b: VendorPaymentInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.pay.createPayment(b, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.ACC_ENTRY) @Post('payments/:id/adjust') @HttpCode(200)
  adjust(@Param('id', ParseUUIDPipe) id: string, @Body(zod(z.object({ billId: uuid, amount: money.refine((v) => Number(v) > 0, 'Enter an amount above zero') }))) b: { billId: string; amount: string }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.pay.adjustAdvance(id, b.billId, b.amount, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.ACC_ENTRY) @Post('payments/:id/cancel') @HttpCode(200)
  cancelPayment(@Param('id', ParseUUIDPipe) id: string, @Body(zod(cancelSchema)) b: Cancel, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.pay.cancelPayment(id, b.reason, b.date, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.ACC_READ) @Get('vouchers')
  vouchers(@Query(zod(z.object({ type: z.enum(['EXPENSE', 'CONTRA', 'JOURNAL', 'BANK']).optional() }))) q: { type?: string }, @Auth() auth: AuthContext) { return this.pay.vouchers(auth, q); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.ACC_ENTRY) @Post('vouchers/expense')
  expense(@Body(zod(expenseVoucherSchema)) b: ExpenseVoucherInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.pay.expense(b, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.ACC_ENTRY) @Post('vouchers/contra')
  contra(@Body(zod(contraSchema)) b: ContraInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.pay.contra(b, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.ACC_ENTRY) @Post('vouchers/journal')
  journal(@Body(zod(journalVoucherSchema)) b: JournalVoucherInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.pay.journal(b, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.ACC_ENTRY) @Post('vouchers/:id/cancel') @HttpCode(200)
  cancelVoucher(@Param('id', ParseUUIDPipe) id: string, @Body(zod(cancelSchema)) b: Cancel, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.pay.cancelVoucher(id, b.reason, b.date, auth, c); }

  // ───── Bank reconciliation ─────
  @RequireModule(M) @RequirePermission(PERMISSIONS.ACC_BANK) @Post('bank/statements/preview') @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  statementPreview(@UploadedFile() file: Blob | undefined, @Auth() auth: AuthContext) { return this.bank.preview(file, auth); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.ACC_BANK) @Post('bank/statements')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 2 } }))
  importStatement(@UploadedFile() file: Blob | undefined, @Body() body: { mapping?: string }, @Auth() auth: AuthContext, @Client() c: ClientInfo) {
    let raw: unknown;
    try { raw = JSON.parse(body.mapping ?? ''); } catch { throw new AppError(422, 'bad-mapping', 'Choose which columns hold the date, description, debit and credit'); }
    const m = zod(statementMappingSchema).transform(raw) as StatementMapping;
    return this.bank.importStatement(file, m, auth, c);
  }

  @RequireModule(M) @RequirePermission(PERMISSIONS.ACC_BANK) @Get('bank/:bankAccountId/workbench')
  workbench(@Param('bankAccountId', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.bank.workbench(id, auth); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.ACC_BANK) @Post('bank/:bankAccountId/auto-match') @HttpCode(200)
  autoMatch(@Param('bankAccountId', ParseUUIDPipe) id: string, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.bank.autoMatch(id, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.ACC_BANK) @Post('bank/match') @HttpCode(200)
  match(@Body(zod(matchSchema)) b: { statementLineId: string; journalLineIds: string[] }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.bank.match(b.statementLineId, b.journalLineIds, 'MANUAL', auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.ACC_BANK) @Post('bank/lines/:id/unmatch') @HttpCode(200)
  unmatch(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.bank.unmatch(id, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.ACC_BANK) @Post('bank/lines/:id/ignore') @HttpCode(200)
  ignore(@Param('id', ParseUUIDPipe) id: string, @Body(zod(ignoreLineSchema)) b: { reason: string }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.bank.ignore(id, b.reason, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.ACC_BANK) @Post('bank/lines/:id/post') @HttpCode(200)
  postLine(@Param('id', ParseUUIDPipe) id: string, @Body(zod(postLineSchema)) b: { accountId: string; narration: string }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.bank.postLine(id, b.accountId, b.narration, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.ACC_BANK) @Get('bank/:bankAccountId/statement')
  reconStatement(@Param('bankAccountId', ParseUUIDPipe) id: string, @Query(zod(z.object({ asOn: z.string().date() }))) q: { asOn: string }, @Auth() auth: AuthContext) { return this.bank.statement(id, q.asOn, auth); }

  // ───── Reports ─────
  @RequireModule(M) @RequirePermission(PERMISSIONS.ACC_READ) @Get('reports/:code')
  report(@Param('code', zod(z.enum(REPORTS))) code: ReportCode, @Query(zod(accountsReportQuerySchema)) q: AccountsReportQuery, @Auth() auth: AuthContext) { return this.reports.run(code, q, auth); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.ACC_READ) @Get('reports/:code/excel')
  async reportExcel(@Param('code', zod(z.enum(REPORTS))) code: ReportCode, @Query(zod(accountsReportQuerySchema)) q: AccountsReportQuery, @Auth() auth: AuthContext) {
    const r = await this.reports.run(code, q, auth);
    const data = await this.reports.excel(r);
    const name = `${r.title} ${q.from} to ${q.to}.xlsx`;
    return new StreamableFile(data, { type: XLSX, length: data.length, disposition: `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}` });
  }
}
