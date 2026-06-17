type TabPackLogLevel = "info" | "start" | "progress" | "success" | "warning" | "error";

interface TabPackConstantsApi {
  EXPORT_PAGE_PATH: string;
  ROOT_FOLDER_NAME: string;
  MAX_FOLDER_NAME_LENGTH: number;
  MAX_ASSET_FILE_NAME_LENGTH: number;
  HTML_PAGE_MODE: string;
  HTML_LOCAL_ASSET_PATHS_MODE: string;
  HTML_RELEVANT_ASSETS_MODE: string;
  HTML_ALL_ASSETS_MODE: string;
  CSV_MODE: string;
  MHTML_MODE: string;
  HTML_ASSET_NONE: string;
  HTML_ASSET_RELEVANT: string;
  HTML_ASSET_ALL: string;
  CSV_FILE_NAME: string;
  TITLE_FILENAME_LIMIT: number;
  RUN_SERIALIZER_IN_TAB_MESSAGE: string;
}

interface TabPackBrowserApi {
  createTab(options: chrome.tabs.CreateProperties): Promise<chrome.tabs.Tab>;
  queryTabs(queryInfo: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[]>;
  getTabGroup(groupId: number): Promise<chrome.tabGroups.TabGroup>;
  removeTab(tabId: number): Promise<void>;
  download(options: chrome.downloads.DownloadOptions): Promise<number>;
  executeScript(options: any): Promise<any[]>;
  executeLegacyTabScript(tabId: number, options: Record<string, unknown>): Promise<unknown[]>;
  sendRuntimeMessage(message: unknown): Promise<any>;
  saveAsMHTML(options: chrome.pageCapture.SaveDetails): Promise<Blob>;
  storageGet(keys: string | string[] | Record<string, unknown> | null): Promise<any>;
  storageSet(items: Record<string, unknown>): Promise<void>;
  permissionsContains(permissions: chrome.permissions.Permissions): Promise<boolean>;
  permissionsRequest(permissions: chrome.permissions.Permissions): Promise<boolean>;
  getRuntimeErrorMessage(): string | null;
}

interface TabPackSkippedTab {
  reason: string;
  tabId: number | null;
  groupId: number | null;
  groupName: string;
  groupFolder: string;
  tabIndex: number | null;
  title: string;
  url: string;
}

interface TabPackExportFile {
  selectionKey: string;
  selected: boolean;
  tabId: number;
  tabIndex: number;
  order: number;
  selectedOrderInGroup: number | "";
  title: string;
  url: string;
  outputExtension: string;
  baseFileName: string;
  fileName: string;
  referenceAssetFolderName: string;
  assetFolderName: string;
  plannedRelativePath: string;
  plannedReferenceAssetFolderPath: string;
  plannedAssetFolderPath: string;
}

interface TabPackExportGroup {
  groupId: number;
  originalTitle: string;
  sanitizedFolderName: string;
  firstTabIndex: number;
  selectedCount: number;
  files: TabPackExportFile[];
}

interface TabPackExportPlan {
  mode: string;
  generatedAt: string;
  groups: TabPackExportGroup[];
  skippedTabs: TabPackSkippedTab[];
  totalEligibleTabs: number;
  totalSelectedTabs: number;
  totalDeselectedTabs: number;
  csvFileName: string;
  csvRelativePath: string;
  filenameMode: string;
  preserveOriginalNumbers: boolean;
}

interface TabPackExportResult {
  exportedAt?: string;
  success: number;
  failure: number;
  assetWarnings?: number;
  completedItems: number;
  totalItems: number;
  progressUnit: string;
  pageResults?: TabPackPageResult[];
}

interface TabPackPageResult {
  selectionKey: string;
  groupId: number;
  tabId: number;
  status: string;
  plannedRelativePath: string;
  plannedAssetFolderPath: string;
  requestedRelativePath: string;
  finalRelativePath: string;
  finalAssetFolderPath: string;
  assetWarnings: number;
  error: string;
}

interface TabPackHtmlResource {
  url: string;
  fileName: string;
  kind: string;
}

interface TabPackCapturedPage {
  html: string;
  resources: TabPackHtmlResource[];
}

interface TabPackHtmlAsset {
  url: string;
  fileName: string;
  blob: Blob;
}

interface TabPackAssetFailure {
  url: string;
  fileName: string;
  error: string;
}

interface TabPackHtmlPackage {
  htmlBlob: Blob;
  assets: TabPackHtmlAsset[];
  failures: TabPackAssetFailure[];
}

interface TabPackExportElements {
  scanButton?: HTMLButtonElement;
  exportButton?: HTMLButtonElement;
  retryFailedButton?: HTMLButtonElement;
  stopExportButton?: HTMLButtonElement;
  chooseFolderButton?: HTMLButtonElement;
  selectedFolderText?: HTMLElement;
  createRootFolder?: HTMLInputElement;
  fallbackPanel?: HTMLElement;
  fallbackMessage?: HTMLElement;
  useDownloadsFallback?: HTMLInputElement;
  exportReportCsv?: HTMLInputElement;
  filenameMode?: HTMLInputElement;
  filenameModeButtons?: HTMLButtonElement[];
  preserveOriginalNumbers?: HTMLInputElement;
  closeTabsAfterExport?: HTMLInputElement;
  conflictBehavior?: HTMLInputElement;
  conflictButtons?: HTMLButtonElement[];
  preview?: HTMLElement;
  skippedTabs?: HTMLElement;
  skippedSummaryText?: HTMLElement;
  exportProgressPanel?: HTMLElement;
  exportProgressPercent?: HTMLElement;
  exportProgressBar?: HTMLElement;
  exportProgressTrack?: HTMLElement;
  exportProgressDetail?: HTMLElement;
  progressLog?: HTMLElement;
  eligibleCount?: HTMLElement;
  skippedCount?: HTMLElement;
  successCount?: HTMLElement;
  failureCount?: HTMLElement;
  selectedCount?: HTMLElement;
  modeInputs?: HTMLInputElement[];
}

interface TabPackExportState {
  selectedDirectoryHandle: FileSystemDirectoryHandle | null;
  selectedDirectoryWritable: boolean;
  exportPlan: TabPackExportPlan | null;
  skippedTabs: TabPackSkippedTab[];
  isExporting: boolean;
  stopRequested: boolean;
  exportAbortController: AbortController | null;
  preferencesLoaded: boolean;
  optionalHostPermissionsGranted: boolean;
  latestExportResult: TabPackExportResult | null;
}

interface TabPackExportHelpersApi {
  collectTabGroupIds(tabs: Array<Record<string, any>>, options?: Record<string, unknown>): number[];
  buildExportPlanFromTabs(tabs: Array<Record<string, any>>, groupMetadata: Map<number | string, unknown> | Record<string, unknown>, options?: Record<string, unknown>): TabPackExportPlan;
  applyModeAndPaths(plan: TabPackExportPlan, options?: Record<string, unknown>): TabPackExportPlan;
  buildPlannedRelativePath(groupFolderName: string, fileName: string, options?: Record<string, unknown>): string;
  buildRootRelativePath(fileName: string, options?: Record<string, unknown>): string;
  generateCsvIndex(plan: TabPackExportPlan, options?: Record<string, unknown>): string;
  getSelectedCsvRowCount(plan: TabPackExportPlan): number;
  formatCsvCell(value: unknown): string;
  cleanCsvPageTitle(value: unknown): string;
  summarizeTabs(tabs: Array<Record<string, any>>, options?: Record<string, unknown>): Record<string, number>;
  assignUniqueFolderNames(groups: TabPackExportGroup[]): void;
  sanitizeFolderName(input: unknown, groupId: number): string;
  sanitizePageFileBaseName(input: unknown, maxLength?: number): string;
  isSupportedTabUrl(url: string | undefined): boolean;
  makeSelectionKey(groupId: number, tabId: number): string;
  isHtmlSnapshotMode(mode: string): boolean;
  isHtmlLocalReferenceMode(mode: string): boolean;
  isHtmlAssetMode(mode: string): boolean;
  modeRequiresHostAccess(mode: string): boolean;
  getOptionalHostOrigins(): string[];
}

interface TabPackExportRendererApi {
  renderPreview(): void;
  renderSkippedTabs(): void;
  clearPreview(message: string): void;
  clearSkippedTabs(): void;
  updateExportAvailability(): void;
  updateScanCounters(plan: TabPackExportPlan): void;
  resetCounters(): void;
  setCounter(element: HTMLElement, value: number): void;
  setExportProgressIdle(message: string): void;
  resetExportProgress(totalItems: number, unit: string): void;
  markExportItemsComplete(result: TabPackExportResult, count?: number): void;
  finishExportProgress(result: TabPackExportResult, state: string): void;
  logMessage(message: string, level?: TabPackLogLevel): void;
}

interface TabPackExportDestinationApi {
  initializeDestinationUi(): void;
  restoreRememberedOutputFolder(): Promise<void>;
  chooseOutputFolder(): Promise<void>;
  revealDownloadsFallback(message: string): void;
  ensureSelectedDirectoryReady(): Promise<void>;
  supportsFileSystemAccess(): boolean;
}

interface TabPackHtmlCaptureApi {
  createCompleteHtmlPackage(group: TabPackExportGroup, file: TabPackExportFile, assetFolderName: string, mode: string): Promise<TabPackHtmlPackage>;
  logAssetWarnings(fetchFailures: TabPackAssetFailure[], writeFailures: TabPackAssetFailure[], assetFolderLabel: string): void;
  saveTabAsMhtml(tabId: number): Promise<Blob>;
  isHtmlSnapshotMode(mode: string): boolean;
  isHtmlLocalReferenceMode(mode: string): boolean;
  isHtmlAssetMode(mode: string): boolean;
  getHtmlModeLogLabel(mode: string): string;
}

interface TabPackExportWriterApi {
  ensureOptionalPermissionsForExport(plan: TabPackExportPlan, options?: { downloadsFallback?: boolean }): Promise<void>;
  exportWithFileSystemAccess(plan: TabPackExportPlan, result: TabPackExportResult, options?: { includeCsvReport?: boolean }): Promise<void>;
  exportWithDownloadsFallback(plan: TabPackExportPlan, result: TabPackExportResult, options?: { includeCsvReport?: boolean }): Promise<void>;
  getExportProgressItemCount(plan: TabPackExportPlan, options?: { includeCsvReport?: boolean }): number;
}

interface TabPackExportContext {
  constants: TabPackConstantsApi;
  browserApi: TabPackBrowserApi;
  ExportHelpers: TabPackExportHelpersApi;
  state: TabPackExportState;
  elements: TabPackExportElements;
  getPathOptions(): Record<string, unknown>;
  getSelectedMode(): string;
  isDownloadsFallbackSelected(): boolean;
  shouldExportCsvReport(): boolean;
  getCsvSelectedRowCount(plan: TabPackExportPlan): number;
  buildPlannedRelativePath(groupFolderName: string, fileName: string): string;
  throwIfExportStopped(): void;
  isExportStopError(error: unknown): boolean;
  getErrorMessage(error: unknown): string;
  isUserCancellation(error: unknown): boolean;
  refreshPlanDisplay(): void;
  applyModeAndPaths(plan: TabPackExportPlan): void;
  saveExportPreferences(): void;
  hasRetryableFailedTabs(): boolean;
  renderer: TabPackExportRendererApi | null;
  destination: TabPackExportDestinationApi | null;
  htmlCapture: TabPackHtmlCaptureApi | null;
  writer: TabPackExportWriterApi | null;
}

interface TabPackFactory<TApi> {
  create(context: TabPackExportContext): TApi;
}

declare var TabPackConstants: TabPackConstantsApi;
declare var TabPackBrowserApi: TabPackBrowserApi;
declare var TabPackExportHelpers: TabPackExportHelpersApi;
declare var TabPackExportRenderer: TabPackFactory<TabPackExportRendererApi>;
declare var TabPackExportDestination: TabPackFactory<TabPackExportDestinationApi>;
declare var TabPackHtmlCapture: TabPackFactory<TabPackHtmlCaptureApi>;
declare var TabPackExportWriter: TabPackFactory<TabPackExportWriterApi>;
declare var serializeCompleteHtmlInPage: (options: Record<string, unknown>) => TabPackCapturedPage;
declare var browser: any;
declare function importScripts(...urls: string[]): void;

interface Window {
  showDirectoryPicker?: (options?: { mode?: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle>;
}

interface FileSystemHandle {
  queryPermission?: (descriptor?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>;
  requestPermission?: (descriptor?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>;
}
