from __future__ import annotations

import ipaddress
import os
from pathlib import Path
from urllib.parse import urlsplit

from pydantic import AliasChoices, Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
DATA_OWNER_MARKER = ".weiqi-data-owner"
DATA_OWNER_VALUE = "weiqi-data-v1"


def _is_loopback(hostname: str | None) -> bool:
    if not hostname:
        return False
    if hostname.lower() == "localhost":
        return True
    try:
        return ipaddress.ip_address(hostname).is_loopback
    except ValueError:
        return False


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="WEIQI_",
        env_file=REPOSITORY_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    host: str = "127.0.0.1"
    port: int = Field(default=8010, ge=1024, le=65535)
    data_dir: Path = REPOSITORY_ROOT / "data"

    openai_api_key: SecretStr | None = Field(
        default_factory=lambda: (
            SecretStr(os.environ["OPENAI_API_KEY"]) if os.environ.get("OPENAI_API_KEY") else None
        ),
        validation_alias=AliasChoices("WEIQI_OPENAI_API_KEY", "OPENAI_API_KEY"),
    )
    openai_base_url: str = "https://api.openai.com/v1"
    openai_model: str = Field(default="gpt-5.6-sol", pattern=r"^[A-Za-z0-9._-]{1,100}$")
    openai_reasoning_effort: str = Field(
        default="medium", pattern=r"^(none|low|medium|high|xhigh|max)$"
    )
    localllm_base_url: str = "http://127.0.0.1:8008/v1"
    ollama_base_url: str = "http://127.0.0.1:11434/api"
    localllm_api_key: str = Field(default="local-dev-key", min_length=1, max_length=512)
    coach_model: str = Field(default="localllm-balanced", pattern=r"^[A-Za-z0-9._:/-]{1,200}$")
    vision_model: str = Field(default="localllm-vision", pattern=r"^[A-Za-z0-9._:/-]{1,200}$")
    # Local models remain useful for bounded candidate selection, but prose
    # teaching is opt-in until the configured model passes a factual Weiqi eval.
    localllm_prose_coaching_enabled: bool = False

    katago_enabled: bool = True
    katago_gpu: int = Field(default=1, ge=0, le=15)
    katago_max_visits: int = Field(default=500, ge=1, le=10_000)
    katago_idle_seconds: int = Field(default=180, ge=30, le=3600)
    katago_executable: Path = REPOSITORY_ROOT / ".local/bin/katago"
    katago_config: Path = REPOSITORY_ROOT / "config/katago-analysis-9x9.cfg"
    katago_model: Path = REPOSITORY_ROOT / ".local/models/katago/kata9x9-b18c384nbt-20231025.bin.gz"
    katago_human_model: Path = REPOSITORY_ROOT / ".local/models/katago/b18c384nbt-humanv0.bin.gz"

    # Ordinary 19x19 games use reviewed general networks in a separate,
    # serialized process lane. The small profile serves interactive reads;
    # the larger profile is reserved for an explicit reflection request.
    katago19_enabled: bool = True
    katago19_gpu: int = Field(default=1, ge=0, le=15)
    katago19_idle_seconds: int = Field(default=90, ge=30, le=3600)
    katago19_fast_max_visits: int = Field(default=24, ge=1, le=32)
    katago19_quality_max_visits: int = Field(default=64, ge=1, le=96)
    katago19_fast_timeout_seconds: float = Field(default=20.0, gt=0, le=30.0)
    katago19_quality_timeout_seconds: float = Field(default=60.0, gt=0, le=90.0)
    katago19_config: Path = REPOSITORY_ROOT / "config/katago-analysis-19x19.cfg"
    katago19_fast_model: Path = REPOSITORY_ROOT / ".local/models/katago19/b10c384h6nbttflrs.bin.gz"
    katago19_quality_model: Path = (
        REPOSITORY_ROOT / ".local/models/katago19/b11c768h12nbt3tflrs-fson-silu.bin.gz"
    )

    @field_validator("host")
    @classmethod
    def validate_host(cls, value: str) -> str:
        if value != "127.0.0.1":
            raise ValueError("the Weiqi service is fixed to IPv4 loopback")
        return value

    @field_validator("openai_api_key", mode="before")
    @classmethod
    def blank_openai_key_is_unconfigured(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @field_validator("localllm_base_url")
    @classmethod
    def validate_localllm_url(cls, value: str) -> str:
        parsed = urlsplit(value)
        if (
            parsed.scheme != "http"
            or not _is_loopback(parsed.hostname)
            or parsed.port != 8008
            or parsed.username
            or parsed.password
            or parsed.query
            or parsed.fragment
            or parsed.path.rstrip("/") != "/v1"
        ):
            raise ValueError("LocalLLM must be the loopback gateway at http://127.0.0.1:8008/v1")
        return value.rstrip("/")

    @field_validator("ollama_base_url")
    @classmethod
    def validate_ollama_url(cls, value: str) -> str:
        parsed = urlsplit(value)
        if (
            parsed.scheme != "http"
            or not _is_loopback(parsed.hostname)
            or parsed.port != 11434
            or parsed.username
            or parsed.password
            or parsed.query
            or parsed.fragment
            or parsed.path.rstrip("/") != "/api"
        ):
            raise ValueError("Ollama must be the loopback runtime at http://127.0.0.1:11434/api")
        return value.rstrip("/")

    @field_validator("openai_base_url")
    @classmethod
    def validate_openai_url(cls, value: str) -> str:
        parsed = urlsplit(value)
        if (
            parsed.scheme != "https"
            or parsed.hostname != "api.openai.com"
            or parsed.port not in (None, 443)
            or parsed.username
            or parsed.password
            or parsed.query
            or parsed.fragment
            or parsed.path.rstrip("/") != "/v1"
        ):
            raise ValueError("OpenAI must use the official https://api.openai.com/v1 endpoint")
        return value.rstrip("/")

    def prepare_data_dir(self) -> Path:
        expanded = self.data_dir.expanduser()
        if expanded.is_symlink():
            raise ValueError("data directory must not be a symlink")
        target = expanded.resolve(strict=False)
        forbidden = {Path("/"), Path.home().resolve(), REPOSITORY_ROOT.resolve()}
        if target in forbidden or target.parent == Path("/"):
            raise ValueError("data directory must be a dedicated child directory")
        marker = target / DATA_OWNER_MARKER
        default_target = (REPOSITORY_ROOT / "data").resolve()
        if marker.is_symlink() or (marker.exists() and not marker.is_file()):
            raise ValueError("data ownership marker must be a regular file")
        if marker.is_file():
            if marker.read_text(encoding="ascii").strip() != DATA_OWNER_VALUE:
                raise ValueError("data directory has a foreign ownership marker")
        elif target.is_dir() and target != default_target:
            try:
                has_entries = next(target.iterdir(), None) is not None
            except OSError as exc:
                raise ValueError("data directory cannot be inspected safely") from exc
            if has_entries:
                raise ValueError("existing data directory is not owned by Weiqi")
        target.mkdir(mode=0o700, parents=True, exist_ok=True)
        if not target.is_dir():
            raise ValueError("data path must be a directory")
        target.chmod(0o700)
        if not marker.exists():
            temporary = target / f".{DATA_OWNER_MARKER}.tmp.{os.getpid()}"
            temporary.write_text(DATA_OWNER_VALUE + "\n", encoding="ascii")
            temporary.chmod(0o600)
            temporary.replace(marker)
        marker.chmod(0o600)
        return target


settings = Settings()
