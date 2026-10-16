// Sets data-theme on <html> the way the Velocity Project site does: a choice a reader made there
// (kept in localStorage, which every page on velotype.github.io shares), and the browser's preference otherwise
(function () {
    var theme = null
    try {
        theme = localStorage.getItem("vtd-preferred-theme")
    } catch (error) {}
    if (theme != "light" && theme != "dark") {
        theme = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"
    }
    document.documentElement.setAttribute("data-theme", theme)
})()
