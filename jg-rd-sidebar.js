/* ============================================================
   JG40 - Research Division Sidebar Helper
   Applies .active and aria-current="page" to the matching link
   inside .rd-sidebar-card after the sidebar HTML is fetched in.

   Loaded once per RD page via:
       <script src="/JG40-Build/jg-rd-sidebar.js"></script>

   Called from the page's loadComponent chain:
       loadComponent('rd-sidebar', '/JG40-Build/RD/SubCarpathia/RD_Sidebar.html')
           .then(JG.setActiveSidebarLink);

   Path matching is normalized so that a trailing-slash URL
   (e.g. /RD/SubCarpathia/) matches an explicit /index.html link.
============================================================ */
(function () {
    window.JG = window.JG || {};

    window.JG.setActiveSidebarLink = function () {
        var sidebar = document.querySelector('.rd-sidebar-card');
        if (!sidebar) return;

        var links = sidebar.querySelectorAll('a');
        if (!links.length) return;

        // Normalize current path: trailing slash -> /index.html
        var currentPath = window.location.pathname;
        if (currentPath.charAt(currentPath.length - 1) === '/') {
            currentPath += 'index.html';
        }

        for (var i = 0; i < links.length; i++) {
            var link = links[i];
            var linkPath;
            try {
                linkPath = new URL(link.href, window.location.origin).pathname;
            } catch (e) {
                continue;
            }
            if (linkPath.charAt(linkPath.length - 1) === '/') {
                linkPath += 'index.html';
            }

            if (linkPath === currentPath) {
                link.classList.add('active');
                link.setAttribute('aria-current', 'page');
            }
        }
    };
})();
