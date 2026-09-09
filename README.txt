what it does:
after install, your tab bar, address bar and bookmarks bar of firefox will hide automatically when you move the mouse away from the toolbar area after a 400 millisecond delay. they will all reappear when you move the mouse back to the top of the firefox window. the bookmarks bar will also show a maximum of 4 rows at a time so it is more useable. scroll up and down if you reach 5 rows of bookmarks. everything works the same maximized and when in a smaller window. this works somewhat as a replacement for fullscreen mode. you don't have to click fullscreen anymore to hide the toolbars.

pre-requisite:
Firefox browser installed in Windows 11

installation:
put userChrome.css in the chrome folder of your firefox profile. to find that location, in the address bar of firefox type in about:support and press enter. then find root directory of the profile in use and click open folder there. the windows explorer location of the firefox profile opens. in that folder create a new folder named chrome if it doesn't exist already, then open it. if it does exist already just open it. put the downloaded userChrome.css file into that chrome folder. if you already have something in an existing userChrome.css file there, you may not want to overwrite it. instead you should be able to copy the code from the recently downloaded userChrome.css file then paste it to the bottom of the code in your original userChrome.css file, then save it. restart firefox if opened already, or open it if it was closed. right click in your tab bar, go to bookmarks toolbar, then click "always show". your bookmarks bar will be shown now on multiple rows. you can change this setting back to "never show" to hide the bookmarks if you prefer. 

optional install to get cross window tab dragging working better:
install fx-autoconfig from here so that firefox can use javascripts https://github.com/MrOtherGuy/fx-autoconfig then download the cross-window-drag.uc.js file and put it in the <firefox-profile>/chrome/JS folder. this optional install will make every firefox toolbar in all windows go into the unhidden state while you are moving a firefox tab. the Claude AI can help with install difficulty.  if you don't want to do this part but still want to move tabs around easier you can do a workaround of changing the hide delay in userChrome.css to something like 3000ms. look for this to change near the top of the file --uc-autohide-toolbar-delay: 0350ms;

Fun fact:
I don't know how to code! I got the Anthropic Claude AI to make it!
