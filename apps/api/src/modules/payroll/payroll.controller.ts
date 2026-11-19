import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  EmployeeLoanInput, PERMISSIONS, PayrollAdjustmentInput, SalaryAssignInput, SalaryComponentInput, SalaryStructureInput, StatutoryRuleInput, TaxOpeningInput, taxOpeningSchema,
  employeeLoanSchema, payrollAdjustmentSchema, payrollPaySchema, payrollRunSchema, salaryAssignSchema, salaryComponentSchema, salaryStructureSchema, statutoryRuleSchema,
} from '@eduerp/shared';
import { Auth, Client, ClientInfo, RequireModule, RequirePermission, TenantMember } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { zod } from '../../common/zod.pipe';
import { PayrollSetupService } from './payroll-setup.service';
import { PayrollRunsService } from './payroll-runs.service';
import { PayrollExtraService } from './payroll-extra.service';

const M = 'HR_PAYROLL';
const uuid = z.string().uuid();

/** Payroll (Phase 15 / B4 §3): salary set-up, statutory rules, staff salaries, monthly runs, payslips, loans, statements. */
@Controller('payroll')
export class PayrollController {
  constructor(private readonly setup: PayrollSetupService, private readonly runs: PayrollRunsService, private readonly extra: PayrollExtraService) {}

  // ───── Components, structures, statutory rules ─────
  @RequireModule(M) @RequirePermission(PERMISSIONS.PAYROLL_SALARY_READ) @Get('components')
  components(@Auth() auth: AuthContext) { return this.setup.components(auth); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.PAYROLL_SETUP) @Post('components')
  addComponent(@Body(zod(salaryComponentSchema)) b: SalaryComponentInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.setup.saveComponent(null, b, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.PAYROLL_SETUP) @Put('components/:id')
  editComponent(@Param('id', ParseUUIDPipe) id: string, @Body(zod(salaryComponentSchema)) b: SalaryComponentInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.setup.saveComponent(id, b, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.PAYROLL_SALARY_READ) @Get('structures')
  structures(@Auth() auth: AuthContext) { return this.setup.structures(auth); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.PAYROLL_SETUP) @Post('structures')
  addStructure(@Body(zod(salaryStructureSchema)) b: SalaryStructureInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.setup.saveStructure(null, b, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.PAYROLL_SETUP) @Put('structures/:id')
  editStructure(@Param('id', ParseUUIDPipe) id: string, @Body(zod(salaryStructureSchema)) b: SalaryStructureInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.setup.saveStructure(id, b, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.PAYROLL_SALARY_READ) @Get('statutory-rules')
  rules(@Auth() auth: AuthContext) { return this.setup.rules(auth); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.PAYROLL_SETUP) @Post('statutory-rules')
  addRule(@Body(zod(statutoryRuleSchema)) b: StatutoryRuleInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.setup.saveRule(null, b, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.PAYROLL_SETUP) @Put('statutory-rules/:id')
  editRule(@Param('id', ParseUUIDPipe) id: string, @Body(zod(statutoryRuleSchema)) b: StatutoryRuleInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.setup.saveRule(id, b, auth, c); }

  // ───── Staff salaries ─────
  @RequireModule(M) @RequirePermission(PERMISSIONS.PAYROLL_SALARY_READ) @Get('salaries')
  salaries(@Query(zod(z.object({ campusId: uuid.optional() }))) q: { campusId?: string }, @Auth() auth: AuthContext) { return this.setup.salaries(auth, q.campusId); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.PAYROLL_SALARY_READ) @Get('salaries/:employeeId')
  salary(@Param('employeeId', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.setup.salary(id, auth); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.PAYROLL_SALARY) @Post('salaries/preview') @HttpCode(200)
  preview(@Body(zod(salaryAssignSchema)) b: SalaryAssignInput, @Auth() auth: AuthContext) { return this.setup.preview(b, auth); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.PAYROLL_SALARY) @Post('salaries')
  assign(@Body(zod(salaryAssignSchema)) b: SalaryAssignInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.setup.assign(b, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.PAYROLL_SALARY) @Put('salaries/:employeeId/opening')
  opening(@Param('employeeId', ParseUUIDPipe) id: string, @Body(zod(taxOpeningSchema)) b: TaxOpeningInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.setup.saveOpening(id, b, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.PAYROLL_SETUP) @Get('accounts')
  accounts(@Auth() auth: AuthContext) { return this.setup.accounts(auth); }

  @RequireModule(M) @TenantMember() @Get('bank-accounts')
  bankAccounts(@Auth() auth: AuthContext) { return this.setup.bankAccounts(auth); }

  // ───── Runs ─────
  @RequireModule(M) @TenantMember() @Get('runs')
  runList(@Query(zod(z.object({ status: z.enum(['DRAFT', 'CALCULATED', 'PENDING_APPROVAL', 'APPROVED', 'PAID', 'CANCELLED']).optional() }))) q: { status?: string }, @Auth() auth: AuthContext) { return this.runs.list(auth, q.status); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.PAYROLL_RUN) @Post('runs')
  createRun(@Body(zod(payrollRunSchema)) b: { campusId: string; month: number; year: number }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.runs.create(b.campusId, b.month, b.year, auth, c); }

  @RequireModule(M) @TenantMember() @Get('runs/:id')
  run(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.runs.get(id, auth); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.PAYROLL_RUN) @Post('runs/:id/calculate') @HttpCode(200)
  calculate(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.runs.calculate(id, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.PAYROLL_RUN) @Post('runs/:id/adjustments')
  addAdjustment(@Param('id', ParseUUIDPipe) id: string, @Body(zod(payrollAdjustmentSchema)) b: PayrollAdjustmentInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.runs.addAdjustment(id, b, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.PAYROLL_RUN) @Delete('runs/:id/adjustments/:aid')
  removeAdjustment(@Param('id', ParseUUIDPipe) id: string, @Param('aid', ParseUUIDPipe) aid: string, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.runs.removeAdjustment(id, aid, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.PAYROLL_RUN) @Post('runs/:id/submit') @HttpCode(200)
  submit(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.runs.submit(id, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.PAYROLL_RUN) @Post('runs/:id/cancel') @HttpCode(200)
  cancel(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.runs.cancel(id, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.PAYROLL_PAY) @Post('runs/:id/bank-file') @HttpCode(200)
  bankFile(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.runs.bankFile(id, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.PAYROLL_PAY) @Post('runs/:id/pay') @HttpCode(200)
  pay(@Param('id', ParseUUIDPipe) id: string, @Body(zod(payrollPaySchema)) b: { paidOn: string; bankAccountId: string }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.runs.pay(id, b.paidOn, b.bankAccountId, auth, c); }

  @RequireModule(M) @TenantMember() @Get('runs/:id/report')
  report(@Param('id', ParseUUIDPipe) id: string, @Query(zod(z.object({ kind: z.enum(['register', 'pf', 'esi', 'pt', 'tds']) }))) q: { kind: 'register' | 'pf' | 'esi' | 'pt' | 'tds' }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.extra.report(id, q.kind, auth, c); }

  // ───── Payslips ─────
  @RequireModule(M) @TenantMember() @Get('my-payslips')
  myPayslips(@Auth() auth: AuthContext) { return this.runs.myPayslips(auth); }

  @RequireModule(M) @TenantMember() @Get('payslips/:id')
  payslip(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.runs.payslip(id, auth); }

  // ───── Loans ─────
  @RequireModule(M) @TenantMember() @Get('loans')
  loans(@Query(zod(z.object({ status: z.enum(['PENDING_APPROVAL', 'ACTIVE', 'CLOSED', 'REJECTED', 'CANCELLED']).optional() }))) q: { status?: string }, @Auth() auth: AuthContext) { return this.extra.loans(auth, q.status); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.PAYROLL_LOAN) @Post('loans')
  addLoan(@Body(zod(employeeLoanSchema)) b: EmployeeLoanInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.extra.createLoan(b, auth, c); }

  // ───── Settlement ─────
  @RequireModule(M) @TenantMember() @Get('settlement/:exitId')
  settlement(@Param('exitId', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.extra.settlement(id, auth); }
}
