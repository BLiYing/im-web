import { fileTypeForName } from "./fileTypes";

type FileTypeIconProps = {
  name: string;
  size?: number;
  className?: string;
};

export function FileTypeIcon({ name, size = 32, className }: FileTypeIconProps) {
  const kind = fileTypeForName(name);
  return (
    <img className={className ? `file-type-icon ${className}` : "file-type-icon"}
      width={size} height={size} src={`/file-types/${kind}.svg`} alt="" aria-hidden="true" />
  );
}
