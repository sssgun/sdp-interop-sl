/**
 * Dependencies.
 */
var browserify = require('browserify');
var vinyl_source_stream = require('vinyl-source-stream');
var vinyl_buffer = require('vinyl-buffer');
var gulp = require('gulp');
var rename = require('gulp-rename');
var header = require('gulp-header');
var expect = require('gulp-expect-file');
var fs = require('fs');
var path = require('path');

const PKG = require('./package.json');

gulp.task('browserify', function() {
	return browserify([path.join(__dirname, PKG.main)], {
		standalone: PKG.title
	}).bundle()
        .pipe(vinyl_source_stream(PKG.name + '.js'))
		.pipe(vinyl_buffer())
		.pipe(gulp.dest('dist/'));

});

gulp.task('dist', gulp.series('browserify'));
gulp.task('default', gulp.series('dist'));
