/**
 * Job: Name the top-level screens inside the shared Trail Mapper app shell.
 *
 */
package com.trailmapper.shared

enum class TrailMapperScreen(
    val route: String,
) {
    Home("home"),
    RoutePlanner("route-planner"),
    ExerciseRoutePlanner("exercise-route-planner"),
    LocalGuide("local-guide"),
    About("about"),
}
