import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { config } from './config';
import { Db } from './common/prisma.service';
import { AuditService } from './common/audit.service';
import { AccessGuard } from './common/access.guard';
import { ProblemFilter } from './common/problem';
import { AuthService } from './modules/auth/auth.service';
import { AuthController } from './modules/auth/auth.controller';
import { MeController } from './modules/me/me.controller';
import { TenantsService } from './modules/platform/tenants.service';
import { TenantsController } from './modules/platform/tenants.controller';
import { CampusesService } from './modules/campuses/campuses.service';
import { CampusesController } from './modules/campuses/campuses.controller';
import { UsersService } from './modules/users/users.service';
import { UsersController } from './modules/users/users.controller';
import { AuditController } from './modules/audit/audit.controller';
import { HealthController } from './modules/health/health.controller';
import { OutboxService } from './common/outbox.service';
import { SettingsService } from './modules/settings/settings.service';
import { SettingsController } from './modules/settings/settings.controller';
import { NumberingService } from './modules/numbering/numbering.service';
import { NumberingController } from './modules/numbering/numbering.controller';
import { FilesService } from './modules/files/files.service';
import { FilesController } from './modules/files/files.controller';
import { LocalDiskStorage, STORAGE } from './modules/files/storage';
import { NotificationsService } from './modules/notifications/notifications.service';
import { NotificationsController } from './modules/notifications/notifications.controller';
import { ApprovalsService } from './modules/approvals/approvals.service';
import { ApprovalsController } from './modules/approvals/approvals.controller';
import { AcademicService } from './modules/academic/academic.service';
import { AcademicYearsController, DepartmentsController, HolidaysController } from './modules/academic/academic.controller';
import { AccountLinksService } from './modules/auth/account-links.service';
import { EntitlementsService } from './modules/platform/entitlements.service';
import { MyModulesController, PlansController } from './modules/platform/entitlements.controller';
import { IdempotencyInterceptor } from './common/idempotency.interceptor';
import { StructureService } from './modules/structure/structure.service';
import { StructureController } from './modules/structure/structure.controller';
import { AdmissionsService } from './modules/admissions/admissions.service';
import { AdmissionsController } from './modules/admissions/admissions.controller';
import { StudentsService } from './modules/students/students.service';
import { FeeSetupService } from './modules/fees/fee-setup.service';
import { FeeSetupController } from './modules/fees/fee-setup.controller';
import { FeeBillingService } from './modules/fees/billing.service';
import { FeeBillingController } from './modules/fees/billing.controller';
import { FeeCollectionService } from './modules/fees/collection.service';
import { FeeCollectionController } from './modules/fees/collection.controller';
import { FeeOnlineService } from './modules/fees/online.service';
import { FeeOnlineController, PaymentWebhookController, PublicPayController } from './modules/fees/online.controller';
import { PAYMENT_GATEWAY, createGateway } from './modules/fees/gateway';
import { LateFeeService } from './modules/fees/late-fee.service';
import { FeeDuesService } from './modules/fees/dues.service';
import { FeeDuesController } from './modules/fees/dues.controller';
import { StudentsController } from './modules/students/students.controller';
import { StudentsImporter } from './modules/students/students.importer';
import { StudentLifecycleController } from './modules/students/lifecycle.controller';
import { StudentLifecycleService } from './modules/students/lifecycle.service';
import { ImportsService } from './modules/imports/imports.service';
import { ExportsService } from './modules/imports/exports.service';
import { ExportsController, ImportsController } from './modules/imports/imports.controller';
import { AnyImporter, DepartmentsImporter, HolidaysImporter, IMPORTERS, StaffImporter, UsersImporter } from './modules/imports/importers';
import { StaffController } from './modules/staff/staff.controller';
import { AttendanceController } from './modules/attendance/attendance.controller';
import { AttendanceService } from './modules/attendance/attendance.service';
import { AttendanceCorrectionsService } from './modules/attendance/corrections.service';
import { AttendanceReportsController } from './modules/attendance/reports.controller';
import { AttendanceReportsService } from './modules/attendance/reports.service';
import { LeaveController, StaffAttendanceController } from './modules/leave/leave.controller';
import { LeaveService } from './modules/leave/leave.service';
import { StaffAttendanceService } from './modules/leave/staff-attendance.service';
import { StaffService } from './modules/staff/staff.service';
import { DashboardController } from './modules/dashboard/dashboard.controller';
import { DashboardService } from './modules/dashboard/dashboard.service';
import { PortalController, StudentPortalAccessController } from './modules/portal/portal.controller';
import { PortalAccessService } from './modules/portal/portal-access.service';
import { PortalChildService } from './modules/portal/portal-child.service';
import { TransportController } from './modules/transport/transport.controller';
import { TransportFleetService } from './modules/transport/fleet.service';
import { TransportRoutesService } from './modules/transport/routes.service';
import { TransportRidersService } from './modules/transport/riders.service';
import { HostelController } from './modules/hostel/hostel.controller';
import { HostelSetupService } from './modules/hostel/setup.service';
import { HostelAllotService } from './modules/hostel/allot.service';
import { HostelLifeService } from './modules/hostel/life.service';
import { MessService } from './modules/hostel/mess.service';
import { AcademicsController } from './modules/academics/academics.controller';
import { AcademicSubjectsService } from './modules/academics/subjects.service';
import { TimetableService } from './modules/academics/timetable.service';
import { HomeworkService } from './modules/academics/homework.service';
import { ExamsController } from './modules/exams/exams.controller';
import { ExamSetupService } from './modules/exams/exam-setup.service';
import { ExamsService } from './modules/exams/exams.service';
import { ResultsService } from './modules/exams/results.service';
import { LessonsService } from './modules/academics/lessons.service';
import { MaterialsService } from './modules/academics/materials.service';
import { CertificatesService } from './modules/students/certificates.service';
import { FeedService } from './modules/engagement/feed.service';
import { EventsService } from './modules/engagement/events.service';
import { PtmService } from './modules/engagement/ptm.service';
import { EngagementController, PortalEngagementController } from './modules/engagement/engagement.controller';
import { MeetingsService } from './modules/engagement/meetings.service';
import { ComplaintsService } from './modules/engagement/complaints.service';
import { FrontOfficeService } from './modules/engagement/front-office.service';
import { DeptRequestsService } from './modules/engagement/requests.service';
import { ComplaintsController, DeptRequestsController, FrontOfficeController, MeetingsController, PortalComplaintsController } from './modules/engagement/engagement2.controller';
import { AccountsController } from './modules/accounts/accounts.controller';
import { HrController } from './modules/hr/hr.controller';
import { HrService } from './modules/hr/hr.service';
import { LeaveBalancesService } from './modules/hr/leave-balances.service';
import { ExitsService } from './modules/hr/exits.service';
import { AccountsSetupService } from './modules/accounts/setup.service';
import { VendorsService } from './modules/accounts/vendors.service';
import { AccountPaymentsService } from './modules/accounts/payments.service';
import { BankReconService } from './modules/accounts/bank.service';
import { AccountsReportsService } from './modules/accounts/reports.service';
import { CertificatesController, CertificateVerifyController } from './modules/students/certificates.controller';

const isTest = process.env.NODE_ENV === 'test';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: isTest ? 'silent' : process.env.LOG_LEVEL ?? 'info',
        genReqId: (req, res) => {
          const incoming = req.headers['x-request-id'];
          const id = typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
          res.setHeader('x-request-id', id);
          return id;
        },
        redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]', '*.password'],
        transport: config().NODE_ENV === 'development' ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
      },
    }),
    JwtModule.register({ secret: config().JWT_ACCESS_SECRET }),
  ],
  controllers: [
    AuthController,
    MeController,
    TenantsController,
    CampusesController,
    UsersController,
    AuditController,
    HealthController,
    SettingsController,
    NumberingController,
    FilesController,
    NotificationsController,
    ApprovalsController,
    AcademicYearsController,
    DepartmentsController,
    HolidaysController,
    PlansController,
    MyModulesController,
    ImportsController,
    ExportsController,
    StructureController,
    AdmissionsController,
    StudentsController,
    StudentLifecycleController,
    StaffController,
    AttendanceController,
    AttendanceReportsController,
    LeaveController,
    StaffAttendanceController,
    FeeSetupController,
    FeeBillingController,
    FeeCollectionController,
    FeeOnlineController,
    PublicPayController,
    PaymentWebhookController,
    FeeDuesController,
    DashboardController,
    StudentPortalAccessController,
    PortalController,
    TransportController,
    HostelController,
    AcademicsController,
    ExamsController,
    CertificatesController,
    CertificateVerifyController,
    EngagementController,
    PortalEngagementController,
    MeetingsController,
    ComplaintsController,
    FrontOfficeController,
    DeptRequestsController,
    PortalComplaintsController,
    AccountsController,
    HrController,
  ],
  providers: [
    Db,
    AuditService,
    AuthService,
    TenantsService,
    CampusesService,
    UsersService,
    OutboxService,
    SettingsService,
    NumberingService,
    FilesService,
    { provide: STORAGE, useClass: LocalDiskStorage },
    NotificationsService,
    ApprovalsService,
    AcademicService,
    AccountLinksService,
    EntitlementsService,
    DepartmentsImporter,
    HolidaysImporter,
    UsersImporter,
    {
      provide: IMPORTERS,
      useFactory: (...i: AnyImporter[]) => i,
      inject: [DepartmentsImporter, HolidaysImporter, UsersImporter, StudentsImporter, StaffImporter],
    },
    ImportsService,
    ExportsService,
    StructureService,
    AdmissionsService,
    StudentsService,
    StudentLifecycleService,
    StaffService,
    AttendanceService,
    AttendanceCorrectionsService,
    AttendanceReportsService,
    LeaveService,
    StaffAttendanceService,
    StaffImporter,
    FeeSetupService,
    FeeBillingService,
    FeeCollectionService,
    FeeOnlineService,
    { provide: PAYMENT_GATEWAY, useFactory: createGateway },
    LateFeeService,
    FeeDuesService,
    DashboardService,
    PortalAccessService,
    PortalChildService,
    TransportFleetService,
    TransportRoutesService,
    TransportRidersService,
    HostelSetupService,
    HostelAllotService,
    HostelLifeService,
    AcademicSubjectsService,
    TimetableService,
    HomeworkService,
    ExamSetupService,
    ExamsService,
    ResultsService,
    LessonsService,
    MaterialsService,
    CertificatesService,
    FeedService,
    EventsService,
    PtmService,
    MeetingsService,
    ComplaintsService,
    FrontOfficeService,
    DeptRequestsService,
    AccountsSetupService,
    VendorsService,
    AccountPaymentsService,
    BankReconService,
    AccountsReportsService,
    HrService,
    LeaveBalancesService,
    ExitsService,
    MessService,
    StudentsImporter,
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_GUARD, useClass: AccessGuard },
    { provide: APP_FILTER, useClass: ProblemFilter },
  ],
})
export class AppModule {}
