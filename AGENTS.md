# Trail Mapper Instructions

- Use Kotlin Multiplatform with separate platform entry-point modules.
- Keep Android build files Gradle Kotlin DSL.
- Keep shared routing/domain logic out of platform UI entry points unless a platform API requires it.
- Treat proposed trails as opt-in route data, not default usable infrastructure.
- Do not commit API keys, map provider credentials, signing files, or generated build outputs.
