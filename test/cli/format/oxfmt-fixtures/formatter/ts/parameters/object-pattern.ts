(
  options,
  { log, logger, messenger }: {
    log: LogFun;
    logger: Logger;
    messenger: Messenger;
  }) => {

}

export function useCopyToClipboard({ timeout = 2000, onCopy }: {
  timeout?: number;
  onCopy?: () => void;
} = {}) { }

function callbackUrl(
  { baseUrl, params }: { baseUrl: string; params?: string } = {
    baseUrl: "",
    params: undefined,
  }
) { }

function parseTitle(
  item: PageObjectResponse | DatabaseObjectResponse,
  {
    maxLength = DocumentValidation.maxTitleLength,
  }: { maxLength?: number } = {}
) {}
