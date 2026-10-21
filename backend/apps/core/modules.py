"""Registry of Nexora business modules and the capabilities each contributes.

The shared platform layer (auth, organizations, roles, audit) knows nothing about
specific modules. Each module registers its capabilities from AppConfig.ready(),
and roles reference capabilities by key. A future module (e.g. POS) only needs to
register its own capabilities and use OrganizationScopedModel / ViewSet to inherit
organization isolation and permission enforcement.
"""

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Capability:
    key: str
    label: str
    module: str


@dataclass
class ModuleDefinition:
    key: str
    name: str
    capabilities: dict[str, str] = field(default_factory=dict)
    # role key -> capability keys granted to that role by default (owners get everything)
    role_defaults: dict[str, set[str]] = field(default_factory=dict)


class ModuleRegistry:
    def __init__(self) -> None:
        self._modules: dict[str, ModuleDefinition] = {}
        self._capabilities: dict[str, Capability] = {}

    def register(self, module: ModuleDefinition) -> None:
        if module.key in self._modules:
            raise ValueError(f"Module '{module.key}' is already registered")
        for key, label in module.capabilities.items():
            if key in self._capabilities:
                raise ValueError(f"Capability '{key}' is already registered")
            self._capabilities[key] = Capability(key=key, label=label, module=module.key)
        for keys in module.role_defaults.values():
            unknown = set(keys) - set(module.capabilities)
            if unknown:
                raise ValueError(f"Module '{module.key}' grants unknown capabilities: {unknown}")
        self._modules[module.key] = module

    def capability(self, key: str) -> Capability:
        return self._capabilities[key]

    def has_capability(self, key: str) -> bool:
        return key in self._capabilities

    def capabilities(self) -> list[Capability]:
        return list(self._capabilities.values())

    def modules(self) -> list[ModuleDefinition]:
        return list(self._modules.values())

    def role_defaults(self, role: str) -> set[str]:
        granted: set[str] = set()
        for module in self._modules.values():
            granted |= set(module.role_defaults.get(role, set()))
        return granted


registry = ModuleRegistry()
